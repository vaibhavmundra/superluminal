-- ===========================================================================
-- SUPER LUMINAL — 0005_pending_purchases.sql
--
-- BUY FIRST, SIGN IN AFTERWARDS.
--
-- 0004 assumed a subscription belongs to a signed-in user, because that is the
-- only kind there was: `subscriptions.owner` is the primary key and there is no
-- row without one. But asking somebody to make an account before they can pay is
-- the same mistake this app already refuses to make with the upload — the file is
-- held across the login step and becomes a plan the moment there is a session
-- (see pendingUpload.js). A payment gets the same treatment, and this table is
-- where it waits.
--
-- THE EMAIL IS THE CLAIM TICKET, AND WHY THAT IS SAFE HERE.
--
-- Matching a purchase to an account by email address is normally a bad idea: an
-- email in a payment payload is a string somebody typed on a checkout form, and
-- honouring it would let anyone attach their payment to another person's login.
-- Two things make it sound in this app specifically:
--
--   1. THIS APP HAS NO PASSWORDS. Sign-in is a six-digit code sent to the
--      address (see routes/Login.jsx), so holding a session for an address IS
--      proof of controlling that address. Supabase has already done the
--      verification that an email match would otherwise be assuming.
--   2. THE CLAIM IS MADE SERVER-SIDE FROM THE VERIFIED TOKEN. api/billing.js
--      reads the email out of /auth/v1/user, never out of the request body, and
--      compares it to this row. The browser cannot nominate the address it is
--      claiming for.
--
-- So the worst a person can do by typing somebody else's address at checkout is
-- give that person a subscription they did not pay for. That is a gift, not an
-- attack, and it is the same outcome as buying a gift card for the wrong friend.
--
-- WHY NOT JUST MAKE `subscriptions.owner` NULLABLE. Because it is the primary
-- key, and the uniqueness it enforces — one live subscription per person — is
-- exactly what must NOT hold for unclaimed rows: two people can quite reasonably
-- pay against the same address before either signs in, and a table that cannot
-- hold both loses one of the payments. A separate table also means every query in
-- 0004 keeps its shape: `subscriptions` is still "who is entitled, right now",
-- with no null-owner case to remember anywhere.
-- ===========================================================================

create table if not exists public.pending_purchases (
  id            uuid primary key default gen_random_uuid(),

  -- NORMALISED ON THE WAY IN — lower(trim()) — because "Savitri@Studio.com " and
  -- "savitri@studio.com" are one mailbox and a claim that misses on case is a
  -- payment that silently never arrives. The index below is on the column as
  -- stored, so api/billing.js normalises before both the write and the read; a
  -- functional index would let an un-normalised write in through some other door.
  email         text not null,
  tier          text not null,

  provider                 text not null default 'razorpay',
  -- UNIQUE, AND IT IS THE REPLAY GUARD. The same payment arrives from /verify and
  -- again from the webhook, and the webhook itself is retried until it gets a
  -- 2xx. Every writer inserts with `resolution=ignore-duplicates`, so the index
  -- is what makes "record this purchase" idempotent without anybody holding a
  -- lock.
  provider_payment_id      text,
  provider_order_id        text,
  provider_subscription_id text,
  provider_plan_id         text,
  mode                     text not null default 'subscription',

  currency      text not null default 'USD',
  amount_minor  integer,

  current_period_start timestamptz not null default now(),
  current_period_end   timestamptz not null,

  -- WHO TOOK IT, AND WHEN. Set once, never cleared. Kept rather than deleted for
  -- the same reason `payments` keeps raw webhook bodies: the question this table
  -- exists to answer in a year is "he says he paid before he had an account", and
  -- answering it from a row that was tidied away is not answering it.
  claimed_by    uuid references auth.users (id) on delete set null,
  claimed_at    timestamptz,

  created_at    timestamptz not null default now()
);

-- NOT PARTIAL, AND THAT IS THE FIX RATHER THAN THE STYLE.
--
-- This was `where provider_payment_id is not null`, on the reasoning that only
-- rows with a payment id need de-duplicating. True, and it broke the thing the
-- index exists for: POSTGRES CANNOT USE A PARTIAL INDEX AS AN `ON CONFLICT`
-- ARBITER unless the statement repeats the index predicate, and PostgREST emits
-- `on_conflict=` columns with no WHERE. So every writer using
-- `resolution=ignore-duplicates` fell through to a raw unique violation — a 409
-- that `rest()` throws — instead of the silent no-op the whole idempotency story
-- assumes. The webhook would then have returned 500 to Razorpay for ever on the
-- retry of a payment it had already parked.
--
-- Non-partial costs nothing here, because NULLS ARE DISTINCT in a Postgres unique
-- index: rows with no payment id (a subscription lifecycle event carries none)
-- still never collide with each other. Identical semantics, usable as an arbiter.
create unique index if not exists pending_purchases_payment_idx
  on public.pending_purchases (provider, provider_payment_id);

-- AND A SECOND KEY, FOR THE EVENTS THAT CARRY NO PAYMENT AT ALL.
--
-- subscription.activated, .authenticated, .updated, .pending and .cancelled all
-- arrive with a subscription entity and no payment entity, so their parked rows
-- have a null payment id and the index above cannot dedupe them — and Razorpay
-- retries each event until it gets a 2xx. Without this, one subscription
-- accumulates a row per event per retry, and claimPending then folds a pile of
-- duplicates.
--
-- `(provider_subscription_id, current_period_end)` is the natural identity of
-- "this subscription, this billing period": a retry of the same event repeats
-- both, a genuine renewal changes the second.
create unique index if not exists pending_purchases_period_idx
  on public.pending_purchases (provider_subscription_id, current_period_end)
  where provider_subscription_id is not null and provider_payment_id is null;

-- THE CLAIM LOOKUP, and it is partial on purpose. The only question ever asked
-- of this table on the hot path is "is there anything unclaimed for this
-- address", asked once per session on the first /api/billing state call — so the
-- index holds only the rows that can still answer yes, and stops growing the
-- moment a purchase is claimed.
create index if not exists pending_purchases_unclaimed_idx
  on public.pending_purchases (email, created_at desc)
  where claimed_by is null;

-- For the webhook, which arrives months later knowing only the subscription id
-- and has to find out whether anybody has claimed it yet.
create index if not exists pending_purchases_subscription_idx
  on public.pending_purchases (provider_subscription_id)
  where provider_subscription_id is not null;

create index if not exists pending_purchases_claimed_idx
  on public.pending_purchases (claimed_by, claimed_at desc)
  where claimed_by is not null;

comment on table public.pending_purchases is
  'A payment made before there was an account. Claimed by whoever signs in with '
  'the same verified email. Written only by the service key.';

-- ===========================================================================
-- ROW LEVEL SECURITY — AND THIS TABLE IS THE STRICTEST OF THE FOUR.
--
-- The three tables in 0004 are readable by their owner. This one has NO SELECT
-- POLICY AT ALL, so `authenticated` cannot read a single row of it, and that is
-- deliberate: the rows are keyed on an EMAIL ADDRESS rather than on a user id,
-- and any policy that let a signed-in user read "rows for my address" would be a
-- policy someone could probe with addresses that are not theirs — turning this
-- into an oracle for "has this person bought Super Luminal". A user learns about
-- their own claimed purchase through /api/billing, which reads it with the
-- service key after validating their token, and returns one boolean.
--
-- Enabling RLS with no policies at all is not an unfinished job. It is the
-- strongest statement Postgres offers: nothing gets in, nothing gets out, except
-- the service key, which bypasses RLS by design.
-- ===========================================================================

alter table public.pending_purchases enable row level security;

-- (No policies. See above.)


-- ===========================================================================
-- AND THE SAME PARTIAL-INDEX MISTAKE, CORRECTED IN 0004.
--
-- `payments_provider_payment_idx` was created partial in migration 0004 and is
-- the arbiter for the replay guard in verifyAction — the one that decides whether
-- a payment has already been used by asking whether the insert was ignored. A
-- partial index cannot serve as an `ON CONFLICT` arbiter (see the long note
-- above), so that guard was throwing a 409 rather than returning an empty array,
-- which means BOTH of its branches were dead: "the webhook beat us to it" and
-- "the handler was double-submitted" both surfaced as errors to a user who had
-- just paid.
--
-- Dropped and recreated rather than edited in place in 0004, so that this
-- migration is correct whether or not 0004 has already been run somewhere.
-- ===========================================================================

drop index if exists public.payments_provider_payment_idx;
create unique index if not exists payments_provider_payment_idx
  on public.payments (provider, provider_payment_id, event);
