-- ===========================================================================
-- 0003_admin_console.sql — the operator's window onto the MVP.
--
-- TWO THINGS, AND THE SECOND IS THE INTERESTING ONE.
--
--   1. `profiles.role`, which src/lib/auth.jsx has been reading since the audit
--      overlays went in but which no migration ever declared. It was added by
--      hand in the dashboard, so this file is catching the repo up with the
--      database rather than changing it — `if not exists` throughout, safe to
--      run against a project that already has the column.
--
--   2. `admin_user_stats`, a view that answers "who is using this and what have
--      they made" in ONE query instead of one-per-user.
--
-- WHY A VIEW AND NOT THREE COUNTS IN THE API. The obvious version fetches a page
-- of profiles and then, for each of the twenty, asks the database how many
-- projects and how many plans and how many ready plans — sixty-one round trips
-- to draw one table, and a sort by "most plans" that cannot be expressed at all
-- because the numbers do not exist until after the page has been chosen. The
-- aggregate belongs where the rows are.
--
-- THIS VIEW IS NOT FOR THE BROWSER, and the revoke below is the load-bearing
-- line rather than a formality. A view in Postgres runs with its OWNER's rights
-- by default (security_invoker is off unless asked for), so row-level security
-- on profiles, projects and plans does NOT apply to a select through it — which
-- is exactly what makes it useful to the service key and exactly what would make
-- it a whole-database leak if `authenticated` could reach it. It cannot: the
-- grants below leave it readable only by roles that bypass RLS anyway, and
-- api/admin.js is the only caller.
--
-- The admin check itself lives in api/admin.js, server-side, against this same
-- `role` column. Nothing in the browser is trusted to assert it.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. the role column
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists role smallint not null default 0;

comment on column public.profiles.role is
  '0 = an ordinary user. 1 = an owner of this app: unlocks the audit overlays in '
  'the editor and the admin console. Set by hand; there is deliberately no UI for it.';

-- A user can read their own role (the existing "profiles are self" select policy
-- already covers every column) but must never be able to WRITE it — the update
-- policy lets somebody edit their own row, and without this they could promote
-- themselves to admin with one PATCH from the console. The API would still turn
-- them down, because it re-reads the column with the service key, but a user who
-- can set their own role has already made the column meaningless.
--
-- THE GUARD IS NARROWED TO SELF-EDITS ON PURPOSE. A blanket freeze would also
-- block the service key and the SQL editor, which is how the role is actually
-- granted — including by the statement at the foot of this file, which would
-- then silently do nothing. `auth.uid()` is the caller's user id through
-- PostgREST and null everywhere else, so this reads as: a signed-in user may not
-- change the role on their own row, and nothing else is affected.
create or replace function public.profiles_freeze_role()
returns trigger language plpgsql as $$
begin
  if new.role is distinct from old.role and auth.uid() = new.id then
    new.role = old.role;
  end if;
  return new;
end $$;

drop trigger if exists profiles_role_is_not_self_service on public.profiles;
create trigger profiles_role_is_not_self_service before update on public.profiles
  for each row execute function public.profiles_freeze_role();

-- ---------------------------------------------------------------------------
-- 2. one row per user, with the three numbers the console lists
--
-- LEFT JOINS AGAINST TWO SUBQUERIES, not two correlated counts. A user who has
-- made nothing must still appear — they are the most interesting row on a page
-- about activation — so the joins are outer and the counts coalesce to zero.
--
-- `last_active` is the latest touch across both tables rather than the profile's
-- own updated_at, which only moves when somebody edits their name and is
-- therefore almost always the sign-up date.
-- ---------------------------------------------------------------------------

create or replace view public.admin_user_stats as
select
  p.id,
  p.email,
  p.full_name,
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

-- THE LINE THAT MAKES THE VIEW SAFE. See the header: this view bypasses RLS by
-- construction, so the browser roles must not be able to select from it. Only
-- service_role — which bypasses RLS regardless — may read it.
revoke all on public.admin_user_stats from anon, authenticated;
grant select on public.admin_user_stats to service_role;

-- ---------------------------------------------------------------------------
-- 3. promote yourself
--
-- Uncommented and edited by hand, because an email address baked into a
-- migration is a credential in version control and the next person to run this
-- file against a fresh project would silently make somebody else an owner.
-- ---------------------------------------------------------------------------

-- update public.profiles set role = 1 where email = 'you@example.com';
