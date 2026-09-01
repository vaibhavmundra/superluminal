-- ===========================================================================
-- SUPER LUMINAL — 0004_billing.sql
--
-- Three tables, and the shape of them is one argument repeated: THE BROWSER MAY
-- READ ITS OWN BILLING AND MAY NEVER WRITE ANY OF IT.
--
-- Every other table in this schema is written by the client under RLS — a plan
-- belongs to its owner, the owner edits it, the policy is `owner = auth.uid()`
-- and that is the whole story. Billing cannot work that way. "Which tier am I
-- on" and "how much have I spent" are answers the paying party must not be able
-- to author, so all three tables below are SELECT-only to `authenticated` and
-- have no insert, update or delete policy at all. The only writer is the service
-- key, in api/billing.js and api/razorpay-webhook.js, after it has re-verified
-- the caller from scratch.
--
-- A table with RLS enabled and no write policy is not an oversight to be fixed
-- later; it is the enforcement. Postgres denies what no policy permits.
--
--   subscriptions   one row per owner, or NO ROW, which means free. The gateway's
--                   view of the money: tier, status, period, and the ids needed
--                   to talk to it again.
--   usage_events    APPEND-ONLY. Every square foot and every render pass ever
--                   spent, with the fingerprint that makes a repeat a no-op.
--                   There is no running total anywhere. See src/lib/plans.js.
--   payments        what the gateway told us, kept verbatim. An audit trail for
--                   the question "he says he paid" and the only place a raw
--                   webhook body is retained.
--
-- WHY THERE IS NO `area_used` COLUMN. Because a total stored beside the events
-- it was summed from is a total that is wrong after any path nobody thought
-- about — a refund, a backfill, a webhook that arrived twice. The sum is nine
-- rows of arithmetic in plans.js and it cannot drift from the ledger because it
-- IS the ledger.
--
-- Run it in the Supabase SQL editor, or `supabase db push`. Idempotent: every
-- create is `if not exists` or dropped first, exactly like 0001.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- subscriptions — the gateway's answer, cached where RLS can talk about it
--
-- OWNER IS THE PRIMARY KEY, not a foreign key beside a uuid of its own. One
-- person has one subscription; making that a uniqueness constraint rather than a
-- convention means an upsert is the natural write and a duplicate row — two
-- webhooks racing, a retry after a timeout — is impossible rather than merely
-- unlikely.
-- ---------------------------------------------------------------------------

create table if not exists public.subscriptions (
  owner                   uuid primary key references auth.users (id) on delete cascade,

  -- 'free' | 'studio' | 'pro'. Text and not an enum: the tier list lives in
  -- src/lib/plans.js, which is read by the browser and the API, and adding a
  -- fourth tier should not be a migration. A value this column has never seen
  -- degrades to free in tierOf(), which is the safe direction.
  tier                    text not null default 'free',

  -- Razorpay's own vocabulary, kept verbatim rather than mapped to ours:
  -- created, authenticated, active, pending, halted, cancelled, completed,
  -- expired. Mapping it here would mean this column and the gateway disagreeing
  -- about the same subscription, and the gateway is the one holding the money.
  -- plans.js decides which of these count as live (LIVE_STATUSES).
  status                  text not null default 'inactive',

  provider                text not null default 'razorpay',   -- 'razorpay' | 'paypal'
  provider_customer_id    text,
  provider_subscription_id text,
  provider_plan_id        text,
  -- 'subscription' when the gateway will charge again by mandate, 'order' when
  -- the user bought a single period and must come back. Both are supported (see
  -- RZP_MODE in api/billing.js) and they expire differently, so which one paid
  -- for the current period has to be recorded with it.
  mode                    text not null default 'subscription',

  currency                text not null default 'USD',
  amount_minor            integer,          -- cents/paise, as the gateway takes it

  current_period_start    timestamptz,
  current_period_end      timestamptz,
  cancel_at_period_end    boolean not null default false,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists subscriptions_provider_sub_idx
  on public.subscriptions (provider_subscription_id)
  where provider_subscription_id is not null;

drop trigger if exists subscriptions_touch on public.subscriptions;
create trigger subscriptions_touch before update on public.subscriptions
  for each row execute function public.touch_updated_at();

comment on table public.subscriptions is
  'One row per paying owner, or no row at all, which means free. Written only by '
  'the service key in api/billing.js and api/razorpay-webhook.js.';

-- ---------------------------------------------------------------------------
-- usage_events — the ledger
--
-- APPEND-ONLY BY POLICY AND BY HABIT. Nothing in the app deletes from here. A
-- render pass that was charged and then failed is corrected by a SECOND row with
-- units = -1, not by removing the first: the pair is the story of what happened,
-- and a ledger you can subtract from is a ledger nobody can reconcile.
-- ---------------------------------------------------------------------------

create table if not exists public.usage_events (
  id           uuid primary key default gen_random_uuid(),
  owner        uuid not null references auth.users (id) on delete cascade,

  -- SET NULL AND NOT CASCADE, and this is the important one. A user who deletes
  -- a project must not get their square feet back — the models ran, the layout
  -- was drawn, the export was taken. So the event outlives the plan it came
  -- from and simply forgets which plan that was.
  plan_id      uuid references public.plans (id) on delete set null,

  kind         text not null check (kind in ('layout', 'render_pass')),

  -- Area for a layout, in square feet. Null for a render pass, which is counted
  -- and not measured: two vision calls cost the same whether the wall is nine
  -- feet or ninety.
  area_sqft    numeric(12,2),

  -- Signed, and 1 or -1 in practice. This is what makes a refund an event.
  units        integer not null default 1,

  -- THE IDEMPOTENCY KEY, and the reason a double click is free. For a layout it
  -- is the hash of one outline's geometry, its scale and its plan; for a render
  -- pass it is the hash of one run. Same fingerprint, same charge — the unique
  -- index below turns the second attempt into a no-op rather than a second
  -- debit. See fingerprintOutline() in src/lib/plans.js.
  fingerprint  text not null,

  -- What the client claimed, kept even where the server used a larger figure, so
  -- a client that under-reports is visible rather than merely defeated. See the
  -- note on trust in api/billing.js.
  claimed_sqft numeric(12,2),

  note         text,
  created_at   timestamptz not null default now()
);

-- THE CONSTRAINT THAT DOES THE WORK. Scoped to the owner and the kind: two
-- different people can hold the same fingerprint (identical rooms in identical
-- drawings is not far-fetched) and a refund row must be able to share the
-- fingerprint of the charge it reverses — which is why `units` is not in the
-- key and why a refund carries kind 'render_pass' with a distinct fingerprint
-- suffix. See releasePass() in api/billing.js.
create unique index if not exists usage_events_claim_idx
  on public.usage_events (owner, kind, fingerprint);

create index if not exists usage_events_owner_time_idx
  on public.usage_events (owner, created_at desc);

create index if not exists usage_events_plan_idx
  on public.usage_events (plan_id, created_at desc)
  where plan_id is not null;

comment on table public.usage_events is
  'Append-only. Every square foot and render pass ever spent. There is no stored '
  'total anywhere; balanceFrom() in src/lib/plans.js sums these rows.';

-- ---------------------------------------------------------------------------
-- payments — what the gateway said, verbatim
--
-- WHY KEEP THE RAW BODY. Because the one question this table exists to answer is
-- "he says he paid and the app says he did not", and answering it from our own
-- interpretation of the event is answering it from the thing under suspicion.
-- The raw jsonb is the gateway's own words, signed, at the time.
-- ---------------------------------------------------------------------------

create table if not exists public.payments (
  id                       uuid primary key default gen_random_uuid(),
  owner                    uuid references auth.users (id) on delete set null,
  provider                 text not null default 'razorpay',

  -- UNIQUE, because Razorpay retries a webhook until it gets a 2xx and the same
  -- payment will therefore arrive several times. The insert is `on conflict do
  -- nothing`, which is what makes the handler idempotent for free.
  provider_payment_id      text,
  provider_order_id        text,
  provider_subscription_id text,

  event                    text,            -- 'checkout.verified', 'subscription.charged', …
  status                   text,
  amount_minor             integer,
  currency                 text,
  raw                      jsonb,
  created_at               timestamptz not null default now()
);

create unique index if not exists payments_provider_payment_idx
  on public.payments (provider, provider_payment_id, event)
  where provider_payment_id is not null;

create index if not exists payments_owner_time_idx
  on public.payments (owner, created_at desc);

-- ===========================================================================
-- ROW LEVEL SECURITY
--
-- SELECT ON YOUR OWN ROWS, AND NOTHING ELSE. There is no insert policy, no
-- update policy and no delete policy on any of these three tables, and their
-- absence IS the enforcement — Postgres denies what no policy permits, so the
-- anon key in the browser bundle cannot grant itself a tier or forgive itself a
-- charge no matter what it sends. The service key bypasses RLS entirely and is
-- the only writer; api/billing.js re-verifies the bearer token against
-- /auth/v1/user before it touches anything, exactly as api/admin.js does.
-- ===========================================================================

alter table public.subscriptions enable row level security;
alter table public.usage_events  enable row level security;
alter table public.payments      enable row level security;

drop policy if exists "subscription is own" on public.subscriptions;
create policy "subscription is own" on public.subscriptions
  for select to authenticated using (owner = auth.uid());

drop policy if exists "usage is own" on public.usage_events;
create policy "usage is own" on public.usage_events
  for select to authenticated using (owner = auth.uid());

drop policy if exists "payments are own" on public.payments;
create policy "payments are own" on public.payments
  for select to authenticated using (owner = auth.uid());

-- ---------------------------------------------------------------------------
-- THE TOTAL, ADDED UP BY POSTGRES.
--
-- THIS EXISTS BECAUSE SUMMING THE LEDGER IN JAVASCRIPT WAS A HOLE. api/billing.js
-- used to read the events with `limit=5000` and no ordering and add them up
-- itself, which is fine for a hundred rows and silently wrong past five
-- thousand: PostgREST returns an unordered select in physical order, so the
-- OLDEST five thousand were summed and everything newer was invisible. Twenty
-- five batches of two hundred one-hundredth-of-a-square-foot claims was enough
-- to get there, and from then on the balance read about fifty square feet
-- whatever was actually spent. An unlimited free tier, reachable with a loop.
--
-- One aggregate over `usage_events_owner_time_idx` is exact at any size, cannot
-- be paginated wrongly, and moves the arithmetic to the only place that can see
-- every row.
--
-- SECURITY DEFINER, AND THEN EXECUTE REVOKED FROM EVERYBODY BUT service_role.
-- The owner is a PARAMETER, so a function callable by `authenticated` would be a
-- way to read any account's spend — and `create function` grants EXECUTE to
-- PUBLIC by default, which means the revoke below is not tidying, it is the
-- access control. The service key is the only caller; it has already verified
-- the bearer token and is passing that user's own id.
-- ---------------------------------------------------------------------------

create or replace function public.usage_totals(p_owner uuid, p_from timestamptz default null)
returns table (area numeric, passes bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(sum(case when kind = 'layout' then area_sqft else 0 end), 0)::numeric      as area,
    coalesce(sum(case when kind = 'render_pass' then units else 0 end), 0)::bigint      as passes
  from public.usage_events
  where owner = p_owner
    -- NULL MEANS SINCE THE BEGINNING, which is the free tier: its allowance does
    -- not refresh, so its window has no start. A paid tier passes its own period
    -- start. See windowStart() in src/lib/plans.js — the one place that decides.
    and (p_from is null or created_at >= p_from);
$$;

revoke all on function public.usage_totals(uuid, timestamptz) from public;
revoke all on function public.usage_totals(uuid, timestamptz) from anon;
revoke all on function public.usage_totals(uuid, timestamptz) from authenticated;
grant execute on function public.usage_totals(uuid, timestamptz) to service_role;

comment on function public.usage_totals(uuid, timestamptz) is
  'Exact spend for one owner since a timestamp. service_role only — the owner is '
  'a parameter, so it must never be callable by authenticated.';

-- ---------------------------------------------------------------------------
-- THE OPERATOR'S VIEW — a spend column for the admin console.
--
-- `security_invoker = true` (Postgres 15+, which Supabase is) makes the view run
-- under the RIGHTS OF THE CALLER rather than of its definer. Without it a view
-- over an RLS-protected table is a hole straight through the policy: any signed-in
-- user could select every row in it. With it, a user sees their own line and the
-- service key sees all of them, which is precisely the split the console needs.
-- ---------------------------------------------------------------------------

drop view if exists public.billing_overview;
create view public.billing_overview
  with (security_invoker = true) as
select
  u.owner,
  coalesce(s.tier, 'free')                                        as tier,
  coalesce(s.status, 'inactive')                                  as status,
  s.current_period_start,
  s.current_period_end,
  sum(case when u.kind = 'layout' then u.area_sqft else 0 end)     as area_all_time,
  sum(case when u.kind = 'layout'
             and (s.current_period_start is null
                  or u.created_at >= s.current_period_start)
           then u.area_sqft else 0 end)                            as area_this_period,
  sum(case when u.kind = 'render_pass'
             and (s.current_period_start is null
                  or u.created_at >= s.current_period_start)
           then u.units else 0 end)                                as passes_this_period,
  max(u.created_at)                                                as last_spend_at
from public.usage_events u
left join public.subscriptions s on s.owner = u.owner
group by u.owner, s.tier, s.status, s.current_period_start, s.current_period_end;

grant select on public.billing_overview to authenticated, service_role;

comment on view public.billing_overview is
  'One line per owner who has ever spent anything. security_invoker, so a user '
  'sees only their own row and the service key sees every row.';
