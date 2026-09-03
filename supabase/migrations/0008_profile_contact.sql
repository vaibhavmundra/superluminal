-- ===========================================================================
-- 0008_profile_contact.sql — a WhatsApp number and an occupation.
--
-- THE COLUMNS WERE ADDED BY HAND IN THE DASHBOARD FIRST, and this file is
-- catching the repo up with the database rather than changing it — the same
-- thing 0003 did for `profiles.role`, and for the same reason. A schema that
-- only exists in a live project cannot be rebuilt: `supabase db push` against a
-- fresh instance would produce an app that 400s on the export dialog with
-- "column phone does not exist", and the person hitting it would have no file
-- in the repo to find the answer in. Everything below is `if not exists`, so
-- running it against the project that already has these columns changes nothing
-- but the constraint and the comments.
--
-- WHY THESE TWO FIELDS ARE ON `profiles` AND NOT ON A TABLE OF THEIR OWN. They
-- are one-to-one with the account, they are read on the same screen as the name
-- and the avatar letter, and `profiles` is already the projection of auth.users
-- that RLS can talk about (see 0001). A second table would be a join on every
-- page load to fetch two short strings.
--
-- WHEN THEY ARE ASKED FOR is the part that is not in this file: not at sign-up,
-- but in front of the FIRST EXPORT — see src/lib/profile.js, which argues it,
-- and src/components/ContactGate.jsx, which does it. The short version is that
-- the login is one email and a six-digit code, and every field added to it is a
-- reason not to finish it; by the first export the plan is lit and the file is
-- one click away, so asking is an exchange rather than a toll booth.
--
-- NO NEW POLICIES ARE NEEDED. "profiles update self" from 0001 already lets a
-- user write their own row, and the `profiles_freeze_role` trigger from 0003
-- narrowly protects the one column they must not set. These two are theirs to
-- fill in and theirs to correct.
--
-- Run it in the Supabase SQL editor, or `supabase db push`. Idempotent.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. the columns
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists phone text;

alter table public.profiles
  add column if not exists occupation text;

comment on column public.profiles.phone is
  'WhatsApp number in E.164 — a leading +, a country code, digits, nothing else. '
  'Normalised at the single point of entry (normalisePhone in src/lib/profile.js) '
  'because a column holding "98765 43210", "+91 98765-43210" and "0091 …" for '
  'three people in one country is a column nobody can send a message from.';

comment on column public.profiles.occupation is
  'One of the slugs in OCCUPATIONS (src/lib/profile.js): architect_designer, '
  'engineer, sales, home_owner, other. Slugs and not labels, because the label '
  'is copy and copy gets edited — renaming "Architect / Designer" must not split '
  'a segment in two.';

-- ---------------------------------------------------------------------------
-- 2. the occupation is one of five, or nothing
--
-- A CHECK AND NOT AN ENUM, matching the decision 0004 made for
-- `subscriptions.tier`: the list lives in a JavaScript module that the browser
-- and the API share, and adding a sixth occupation should be a one-line edit
-- rather than a migration and a type alteration.
--
-- NULL IS ALLOWED AND IS THE STARTING STATE. Every account that exists today has
-- one, and the app's whole design is that the question is asked later — a NOT
-- NULL here would mean back-filling a guess for every existing user, which is
-- the one thing worse than not knowing.
--
-- ADDED SEPARATELY FROM THE COLUMN, and guarded, because `add column if not
-- exists` skips its inline constraints entirely when the column is already
-- there — which is exactly the case this file is written for. A constraint
-- declared inside the `alter` above would silently not exist on the one database
-- that matters.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'profiles_occupation_known'
       and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_occupation_known
      check (occupation is null or occupation in
             ('architect_designer', 'engineer', 'sales', 'home_owner', 'other'))
      not valid;
    -- NOT VALID, THEN VALIDATED. The two-step takes a weaker lock than a plain
    -- ADD CONSTRAINT and, more usefully here, it means a row already carrying
    -- some other string does not abort the migration — the validate below
    -- reports it instead, with the value in the error, which is a fixable
    -- morning rather than a failed deploy.
    alter table public.profiles validate constraint profiles_occupation_known;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. the operator's list gets both
--
-- `admin_user_stats` is what /admin/users draws, and "who are these people" is
-- most of the reason to be asking these questions at all. The view is recreated
-- rather than altered because a view's column list cannot be added to in place.
--
-- THE REVOKE AT THE FOOT IS THE LOAD-BEARING LINE, exactly as 0003 says: a view
-- in Postgres runs with its OWNER's rights unless `security_invoker` is asked
-- for, so row-level security on profiles does NOT apply to a select through
-- this one. That is what makes it useful to the service key and what would make
-- it a whole-database leak if `authenticated` could reach it — and it now
-- carries phone numbers, so the stakes went up.
-- ---------------------------------------------------------------------------

-- DROPPED FIRST, AND `create or replace` WOULD NOT HAVE WORKED. Postgres lets a
-- replace APPEND columns to a view and nothing else — inserting `phone` and
-- `occupation` between `full_name` and `role`, where they belong, is renaming
-- every column after them as far as it is concerned, and it refuses with
-- "cannot change name of view column". Appending them to the end instead would
-- have worked and would have put two identity fields after three counts and a
-- timestamp, which is a column order nobody would choose on purpose.
drop view if exists public.admin_user_stats;
create view public.admin_user_stats as
select
  p.id,
  p.email,
  p.full_name,
  p.phone,
  p.occupation,
  p.role,
  p.created_at,
  coalesce(pr.n, 0)::int        as projects,
  coalesce(pl.n, 0)::int        as plans,
  coalesce(pl.ready, 0)::int    as plans_ready,
  greatest(
    coalesce(pr.last_at, 'epoch'::timestamptz),
    coalesce(pl.last_at, 'epoch'::timestamptz)
  )                             as last_active
from public.profiles p
left join (
  select owner, count(*) as n, max(updated_at) as last_at
  from public.projects group by owner
) pr on pr.owner = p.id
left join (
  select owner,
         count(*)                                          as n,
         count(*) filter (where status = 'ready')          as ready,
         max(updated_at)                                   as last_at
  from public.plans group by owner
) pl on pl.owner = p.id;

revoke all on public.admin_user_stats from anon, authenticated;
grant select on public.admin_user_stats to service_role;
