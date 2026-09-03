-- ===========================================================================
-- 0007_free_plan_count.sql — the free tier's second meter.
--
-- Free is now THREE FLOOR PLANS with a 15,000 sq ft backstop, where it used to
-- be 3,000 sq ft and nothing else. Why the offer changed is argued in
-- src/lib/plans.js, at TIERS, and is not repeated here. What this file has to
-- provide is the one number the database cannot currently answer: HOW MANY
-- DISTINCT DRAWINGS HAS THIS OWNER EVER LIT.
--
-- TWO CHANGES, AND THE FIRST ONE IS THE WHOLE PROBLEM.
--
--   1. `usage_events.plan_id` LOSES ITS FOREIGN KEY.
--   2. `usage_totals` grows a third column that counts distinct values of it.
--
-- --- WHY THE FOREIGN KEY HAS TO GO ---------------------------------------
--
-- 0004 declared it `references public.plans (id) on delete set null`, and gave
-- the reason: "A user who deletes a project must not get their square feet back
-- — the models ran, the layout was drawn, the export was taken. So the event
-- outlives the plan it came from and simply forgets which plan that was."
--
-- The intent is exactly right and the mechanism only half delivers it. The event
-- outlives the plan, but FORGETTING WHICH PLAN IT WAS is precisely what a count
-- of drawings cannot survive. `count(distinct plan_id)` ignores nulls, so
-- deleting a drawing hands its slot straight back: "three free plans" becomes
-- "three at a time", and then no limit at all for anybody willing to press
-- Delete between uploads. The most valuable button in the product would be the
-- one that throws work away.
--
-- So the uuid stays put and stops being a reference. Nothing is lost by that:
-- the constraint's only behaviour was the SET NULL, nothing joins to it expecting
-- validity, and a dangling id in a join yields no match — the same answer a null
-- gave. What is gained is that 0004's sentence becomes literally true. The event
-- outlives the plan, and it remembers.
--
-- --- WHY THIS RUNS SAFELY IN EITHER ORDER WITH THE DEPLOY -----------------
--
-- Nothing about the app's WRITES changes: api/billing.js already puts the plan
-- id on every usage event and still does. The only new thing it asks for is the
-- third column below, and `totalsOf` reads it as `Number(r?.plans) || 0` — so
-- against a database where this file has not run yet, the count reads zero and
-- free accounts are metered on area exactly as they were. Code first or
-- migration first, neither breaks; the meter simply becomes correct at the
-- moment this lands.
--
-- WHAT THE OLD ROWS CAN AND CANNOT SAY. Events whose plan was deleted BEFORE
-- this ran already have a null and there is nothing to recover — those count for
-- area and not for plans. That forgives a handful of slots on a handful of
-- existing accounts, once. It is the right direction to be wrong in: generous to
-- people who signed up under the old terms, and unrepeatable, because from here
-- on the id survives.
--
-- Run it in the Supabase SQL editor, or `supabase db push`. Idempotent.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. drop the constraint, keep the column
--
-- BY LOOKUP RATHER THAN BY NAME. `usage_events_plan_id_fkey` is what Postgres
-- would have called it and almost certainly did, but a table created by hand, or
-- restored from a dump, or touched by the Supabase table editor can carry a
-- different name — and a hard-coded `drop constraint if exists` against the
-- wrong one succeeds silently while changing nothing, which would leave the free
-- tier resettable with no error anywhere to say so. So the catalogue is asked.
-- ---------------------------------------------------------------------------

do $$
declare
  c record;
begin
  for c in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace ns on ns.oid = rel.relnamespace
     where ns.nspname = 'public'
       and rel.relname = 'usage_events'
       and con.contype = 'f'
       and con.conkey = array[
             (select attnum from pg_attribute
               where attrelid = rel.oid and attname = 'plan_id')
           ]::smallint[]
  loop
    execute format('alter table public.usage_events drop constraint %I', c.conname);
    raise notice 'dropped foreign key % on usage_events.plan_id', c.conname;
  end loop;
end $$;

comment on column public.usage_events.plan_id is
  'WHICH DRAWING WAS LIT. Deliberately NOT a foreign key — see 0007. The free '
  'tier is metered on the COUNT of distinct drawings, and a reference that is '
  'nulled when its plan is deleted is a count anybody can reset by deleting. '
  'Never add a constraint back to it.';

-- The index the "have I already lit this one" probe uses, once per claim on a
-- free account. Partial and scoped to layouts, because a render pass carries a
-- plan id too and is never counted.
create index if not exists usage_events_owner_plan_idx
  on public.usage_events (owner, plan_id)
  where kind = 'layout' and plan_id is not null;

-- ---------------------------------------------------------------------------
-- 2. the totals, with the count added
--
-- DROPPED AND RECREATED RATHER THAN REPLACED. `create or replace function`
-- cannot change a function's return type, and this one grows a third column — a
-- plain replace fails with "cannot change return type of existing function".
--
-- EVERY NOTE FROM 0004 STILL APPLIES and is restated rather than assumed,
-- because this is the function that decides whether somebody is refused:
--
--   · ONE AGGREGATE, IN POSTGRES. The first version summed the ledger in
--     JavaScript over a `limit=5000` select with no ordering, which meant the
--     OLDEST five thousand rows were counted and everything newer was invisible
--     — an unlimited free tier, reachable with a loop.
--   · SECURITY DEFINER, AND EXECUTE REVOKED FROM EVERYBODY BUT service_role.
--     The owner is a PARAMETER, so a function callable by `authenticated` would
--     be a way to read any account's spend, and `create function` grants EXECUTE
--     to PUBLIC by default. The revoke below is not tidying, it is the access
--     control.
--   · NULL `p_from` MEANS SINCE THE BEGINNING, which is the free tier: its
--     allowance does not refresh, so its window has no start. windowStart() in
--     src/lib/plans.js is the one place that decides.
-- ---------------------------------------------------------------------------

drop function if exists public.usage_totals(uuid, timestamptz);

create function public.usage_totals(p_owner uuid, p_from timestamptz default null)
returns table (area numeric, passes bigint, plans bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(sum(case when kind = 'layout' then area_sqft else 0 end), 0)::numeric   as area,
    coalesce(sum(case when kind = 'render_pass' then units else 0 end), 0)::bigint   as passes,
    -- DISTINCT DRAWINGS LIT. `count(distinct …)` ignores nulls, which is correct
    -- and is NOT the hole described in the header: a null plan_id is now only an
    -- event that never knew which drawing it belonged to — a pre-0007 row whose
    -- plan had already been deleted, or the standalone editor, which has no plan
    -- row at all. The hole was counting a column that got nulled underneath you,
    -- and it no longer can be.
    count(distinct case when kind = 'layout' then plan_id end)::bigint               as plans
  from public.usage_events
  where owner = p_owner
    and (p_from is null or created_at >= p_from);
$$;

revoke all on function public.usage_totals(uuid, timestamptz) from public;
revoke all on function public.usage_totals(uuid, timestamptz) from anon;
revoke all on function public.usage_totals(uuid, timestamptz) from authenticated;
grant execute on function public.usage_totals(uuid, timestamptz) to service_role;

comment on function public.usage_totals(uuid, timestamptz) is
  'Exact spend for one owner since a timestamp: square feet, render passes, and '
  'the count of distinct drawings lit. service_role only — the owner is a '
  'parameter, so it must never be callable by authenticated.';

-- ---------------------------------------------------------------------------
-- 3. the operator's view gets the same column
--
-- So the console can answer "how close is this account to its three" in the
-- query it already asks about area. `security_invoker = true` for the reason
-- 0004 gives: a view over an RLS-protected table without it is a hole straight
-- through the policy.
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
  count(distinct case when u.kind = 'layout' then u.plan_id end)   as plans_all_time,
  max(u.created_at)                                                as last_spend_at
from public.usage_events u
left join public.subscriptions s on s.owner = u.owner
group by u.owner, s.tier, s.status, s.current_period_start, s.current_period_end;

grant select on public.billing_overview to authenticated, service_role;

comment on view public.billing_overview is
  'One line per owner who has ever spent anything. security_invoker, so a user '
  'sees only their own row and the service key sees every row.';
