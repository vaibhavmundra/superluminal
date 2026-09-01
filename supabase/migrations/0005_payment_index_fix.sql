-- ===========================================================================
-- SUPER LUMINAL — 0005_payment_index_fix.sql
--
-- ONE INDEX, AND IT IS THE REPLAY GUARD.
--
-- `verifyAction` in api/billing.js decides whether a Razorpay payment has already
-- been used by inserting it into `payments` with
-- `Prefer: resolution=ignore-duplicates,return=representation` and looking at what
-- comes back: a row means this is the first time, an EMPTY ARRAY means the unique
-- index refused it and the payment is a replay. That is the whole reason one
-- payment cannot be re-posted every month to renew a subscription for free.
--
-- IT DID NOT WORK, FOR A REASON THAT IS INVISIBLE UNTIL YOU LOOK AT THE EMITTED
-- SQL. Two things had to be true and neither was:
--
--   1. POSTGREST MUST BE TOLD THE CONFLICT TARGET. Without `on_conflict=`, it
--      infers the PRIMARY KEY — and this table's PK is a surrogate `id uuid
--      default gen_random_uuid()` that is never in the payload, so the emitted
--      `ON CONFLICT (id) DO NOTHING` can never fire. Fixed in api/billing.js and
--      api/razorpay-webhook.js, which now name the columns.
--   2. THE INDEX MUST NOT BE PARTIAL. Postgres cannot use a partial index as an
--      `ON CONFLICT` arbiter unless the statement repeats the index predicate,
--      and PostgREST emits no WHERE. `payments_provider_payment_idx` was created
--      in 0004 with `where provider_payment_id is not null`. That is what this
--      migration fixes.
--
-- Until both were true, a duplicate surfaced as a raw unique violation — a 409
-- that `rest()` throws — so the guard's two graceful branches ("the webhook beat
-- us to it", "the handler was double-submitted") were dead code, and a retried
-- webhook would have returned 500 to Razorpay for ever.
--
-- NON-PARTIAL COSTS NOTHING HERE, because NULLS ARE DISTINCT in a Postgres unique
-- index: the rows with no payment id that this predicate was written to exclude
-- still never collide with each other. Identical semantics, usable as an arbiter.
--
-- Dropped and recreated rather than edited in place in 0004, so this is correct
-- whether or not 0004 has already been run.
-- ===========================================================================

drop index if exists public.payments_provider_payment_idx;

create unique index if not exists payments_provider_payment_idx
  on public.payments (provider, provider_payment_id, event);

comment on index public.payments_provider_payment_idx is
  'The replay guard for verifyAction. Must stay NON-PARTIAL: PostgREST''s '
  'ignore-duplicates needs it as an ON CONFLICT arbiter.';
