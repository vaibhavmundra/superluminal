-- ===========================================================================
-- SUPER LUMINAL — 0001_init.sql
--
-- Four tables, and the shape of them is an argument about what this app is for.
--
-- A lighting layout is not the valuable artefact here. The valuable artefact is
-- the PAIR: what the segmenter proposed, and what a human being then did about
-- it. That is the thing a model can learn from, and it is the reason `plans`
-- holds three jsonb columns rather than one, and the reason `plan_revisions`
-- exists at all:
--
--   editor_state   the room outlines AS EDITED, plus every other correction —
--                  room types, no-light zones, ceiling objects, the accents that
--                  were dismissed. Overwritten by the autosave; it is "now".
--   design_json    the finished layout in feet, in the same shape the JSON
--                  export produces. What was actually delivered.
--   boq_json       the schedule that was billed from it.
--   plan_revisions APPEND-ONLY. One row per milestone, never per keystroke.
--                  This is the corpus; the columns above are the working copy.
--
-- WHY OWNER IS DUPLICATED ON EVERY TABLE. `plans.owner` is derivable through
-- `project_id`, and denormalising it means every RLS policy is `owner =
-- auth.uid()` — an index probe — instead of a join to `projects` evaluated once
-- per row on every read. Triggers below keep it honest so it can never disagree
-- with the project it belongs to.
--
-- Run it in the Supabase SQL editor, or `supabase db push` if you use the CLI.
-- It is idempotent enough to re-run: every create is `if not exists` or dropped
-- first.
-- ===========================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- profiles — the browser cannot read auth.users, so this is the projection of
-- it that RLS can talk about. It exists for one letter in a circle and the name
-- behind it, and that is enough reason: the alternative is reading the name out
-- of the JWT, which goes stale the moment somebody changes it.
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- A ROW PER USER, CREATED BY THE DATABASE. Doing this from the client after
-- sign-in is the version that silently fails: the OTP flow can land a session in
-- a tab that immediately navigates, and then there is a user with no profile and
-- an empty bubble forever.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, ''), '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Existing users, if any, get one too.
insert into public.profiles (id, email, full_name)
select u.id, u.email, split_part(coalesce(u.email, ''), '@', 1)
from auth.users u
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------

create table if not exists public.projects (
  id            uuid primary key default gen_random_uuid(),
  owner         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name          text not null default 'Untitled project',
  -- The kind of BUILDING (residential, hospitality, …) — see src/lib/roomTypes.js.
  -- Nullable because it is answered per plan and only later becomes a property
  -- of the project.
  project_type  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists projects_owner_updated_idx
  on public.projects (owner, updated_at desc);

drop trigger if exists projects_touch on public.projects;
create trigger projects_touch before update on public.projects
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- plans — one drawing, and everything that was decided about it
-- ---------------------------------------------------------------------------

create table if not exists public.plans (
  id            uuid primary key default gen_random_uuid(),
  owner         uuid not null references auth.users (id) on delete cascade,
  project_id    uuid not null references public.projects (id) on delete cascade,

  name          text not null default 'Untitled plan',
  -- Derived from what exists rather than set by hand — see statusFrom() in
  -- src/lib/planState.js. 'failed' is reserved for an upload that did not land.
  status        text not null default 'uploaded'
                check (status in ('uploaded', 'tracing', 'planning', 'ready', 'failed')),

  -- the drawing itself, in the `uploads` bucket
  source_kind   text not null default 'raster' check (source_kind in ('raster', 'vector')),
  storage_path  text,          -- uploads/<user>/<plan>/source.<ext>
  file_name     text,
  mime          text,
  bytes         bigint,

  -- how the drawing was read
  width         integer,
  height        integer,
  px_per_ft     numeric,
  units         text,
  project_type  text,

  -- THE THREE PAYLOADS. See the header.
  editor_state  jsonb,
  design_json   jsonb,
  boq_json      jsonb,

  -- small, flat, and read by every card so a list never has to touch the jsonb
  stats         jsonb,
  snapshot_path text,          -- uploads/<user>/<plan>/snapshot.png

  last_opened_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists plans_project_updated_idx on public.plans (project_id, updated_at desc);
create index if not exists plans_owner_updated_idx   on public.plans (owner, updated_at desc);
-- For "which plans have a finished design" — the query a training export starts
-- with. Partial, so it indexes the few hundred rows that matter and not the
-- drafts.
create index if not exists plans_ready_idx on public.plans (owner, updated_at desc)
  where status = 'ready';

-- OPENING A PLAN IS NOT EDITING IT, and the shared touch trigger cannot tell
-- the difference. `last_opened_at` moves every time somebody opens a drawing; if
-- that bumped `updated_at` the dashboard would re-sort itself because a plan was
-- looked at, and "recently worked on" would mean "recently glanced at". So when
-- the ONLY change is that timestamp, updated_at is left exactly where it was.
create or replace function public.plans_touch_updated()
returns trigger language plpgsql as $$
begin
  if new.last_opened_at is distinct from old.last_opened_at
     and (to_jsonb(new) - 'last_opened_at' - 'updated_at')
       = (to_jsonb(old) - 'last_opened_at' - 'updated_at') then
    new.updated_at = old.updated_at;
    return new;
  end if;
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists plans_touch on public.plans;
create trigger plans_touch before update on public.plans
  for each row execute function public.plans_touch_updated();

-- OWNER COMES FROM THE PROJECT, NOT FROM THE CLIENT. The insert in db.js does
-- send it, and this overwrites it anyway: a client-supplied owner is a client
-- claim, and the point of the denormalised column is that it can be trusted by
-- the policies.
create or replace function public.plans_set_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select p.owner into new.owner from public.projects p where p.id = new.project_id;
  if new.owner is null then
    raise exception 'project % does not exist', new.project_id;
  end if;
  return new;
end $$;

drop trigger if exists plans_owner_from_project on public.plans;
create trigger plans_owner_from_project before insert or update of project_id on public.plans
  for each row execute function public.plans_set_owner();

-- A PLAN CHANGING MAKES ITS PROJECT RECENT. Without this the dashboard sorts
-- projects by when they were renamed, which is never, so the list is frozen in
-- creation order while the work moves around underneath it.
create or replace function public.touch_project_from_plan()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- An open that did not move updated_at (see plans_touch_updated) must not move
  -- the project's either, or the exemption above is undone one trigger later.
  if tg_op = 'UPDATE' and new.updated_at = old.updated_at then
    return null;
  end if;
  update public.projects set updated_at = now()
   where id = coalesce(new.project_id, old.project_id);
  return null;
end $$;

drop trigger if exists plans_touch_project on public.plans;
create trigger plans_touch_project after insert or update or delete on public.plans
  for each row execute function public.touch_project_from_plan();

-- ---------------------------------------------------------------------------
-- plan_revisions — the append-only trail, and the training corpus
-- ---------------------------------------------------------------------------

create table if not exists public.plan_revisions (
  id            uuid primary key default gen_random_uuid(),
  plan_id       uuid not null references public.plans (id) on delete cascade,
  owner         uuid not null references auth.users (id) on delete cascade,
  -- WHAT HAPPENED, not when. 'outlines' = the spaces were confirmed (the
  -- segmenter's answer plus the corrections); 'design' = a layout was computed;
  -- 'export' = somebody took it away, which is the strongest signal that a
  -- design was considered finished.
  kind          text not null check (kind in ('outlines', 'design', 'export', 'manual')),
  editor_state  jsonb,
  design_json   jsonb,
  boq_json      jsonb,
  stats         jsonb,
  snapshot_path text,
  created_at    timestamptz not null default now()
);

create index if not exists plan_revisions_plan_idx on public.plan_revisions (plan_id, created_at desc);
create index if not exists plan_revisions_owner_idx on public.plan_revisions (owner, created_at desc);
create index if not exists plan_revisions_kind_idx on public.plan_revisions (kind, created_at desc);

create or replace function public.revisions_set_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select p.owner into new.owner from public.plans p where p.id = new.plan_id;
  if new.owner is null then
    raise exception 'plan % does not exist', new.plan_id;
  end if;
  return new;
end $$;

drop trigger if exists revisions_owner_from_plan on public.plan_revisions;
create trigger revisions_owner_from_plan before insert on public.plan_revisions
  for each row execute function public.revisions_set_owner();

-- NO UPDATE AND NO DELETE POLICY IS WRITTEN FOR THIS TABLE, which is how
-- "append-only" is enforced: RLS denies anything a policy does not permit, so
-- there is nothing to remember not to do.

-- ===========================================================================
-- ROW-LEVEL SECURITY
--
-- The anon key is in the browser bundle by design. These policies are the only
-- thing standing between one studio's drawings and another's — read them as the
-- actual security boundary, not as configuration.
-- ===========================================================================

alter table public.profiles       enable row level security;
alter table public.projects       enable row level security;
alter table public.plans          enable row level security;
alter table public.plan_revisions enable row level security;

-- profiles: yours, and only yours.
drop policy if exists "profiles are self" on public.profiles;
create policy "profiles are self" on public.profiles
  for select to authenticated using (id = auth.uid());

drop policy if exists "profiles update self" on public.profiles;
create policy "profiles update self" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "profiles insert self" on public.profiles;
create policy "profiles insert self" on public.profiles
  for insert to authenticated with check (id = auth.uid());

-- projects
drop policy if exists "projects are own" on public.projects;
create policy "projects are own" on public.projects
  for select to authenticated using (owner = auth.uid());

drop policy if exists "projects insert own" on public.projects;
create policy "projects insert own" on public.projects
  for insert to authenticated with check (owner = auth.uid());

drop policy if exists "projects update own" on public.projects;
create policy "projects update own" on public.projects
  for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());

drop policy if exists "projects delete own" on public.projects;
create policy "projects delete own" on public.projects
  for delete to authenticated using (owner = auth.uid());

-- plans. INSERT CHECKS THE PROJECT, NOT THE OWNER COLUMN: the owner is
-- overwritten by a trigger, so a policy on it would be checking a value the
-- client does not ultimately control. What must be true is that the project
-- being written into belongs to the caller.
drop policy if exists "plans are own" on public.plans;
create policy "plans are own" on public.plans
  for select to authenticated using (owner = auth.uid());

drop policy if exists "plans insert into own project" on public.plans;
create policy "plans insert into own project" on public.plans
  for insert to authenticated with check (
    exists (select 1 from public.projects p where p.id = project_id and p.owner = auth.uid())
  );

drop policy if exists "plans update own" on public.plans;
create policy "plans update own" on public.plans
  for update to authenticated using (owner = auth.uid()) with check (
    exists (select 1 from public.projects p where p.id = project_id and p.owner = auth.uid())
  );

drop policy if exists "plans delete own" on public.plans;
create policy "plans delete own" on public.plans
  for delete to authenticated using (owner = auth.uid());

-- plan_revisions: read and append. Nothing else, deliberately.
drop policy if exists "revisions are own" on public.plan_revisions;
create policy "revisions are own" on public.plan_revisions
  for select to authenticated using (owner = auth.uid());

drop policy if exists "revisions insert own plan" on public.plan_revisions;
create policy "revisions insert own plan" on public.plan_revisions
  for insert to authenticated with check (
    exists (select 1 from public.plans p where p.id = plan_id and p.owner = auth.uid())
  );

-- ===========================================================================
-- REALTIME
--
-- The dashboard and the project page are lists that change from somewhere else
-- — the autosave in another tab, a second window, a phone. A subscription is one
-- socket that stays silent until something happens; polling is a request every
-- few seconds forever for a change that happens twice an hour.
--
-- THE COLUMN LIST IS THE IMPORTANT PART. `plans` carries three jsonb columns
-- that are routinely megabytes, and the autosave writes them every couple of
-- seconds while somebody drags a fitting. Replicating the whole row would push
-- that entire payload down every open socket on every keystroke — the exact
-- opposite of the performance this is for. So the publication carries only the
-- columns a card is drawn from; a client that needs the geometry fetches the row
-- it is opening.
--
-- Requires PostgreSQL 15+ (Supabase is well past it). On anything older, drop
-- the parenthesised list and instead keep the heavy columns in a side table.
-- ===========================================================================

-- Wrapped, because `add table` on a table that is already a member of the
-- publication is an error, and this file is meant to survive being re-run.
do $$
begin
  alter publication supabase_realtime add table public.projects;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.plans (
    id, project_id, owner, name, status, source_kind, storage_path, snapshot_path,
    file_name, width, height, px_per_ft, project_type, stats,
    last_opened_at, created_at, updated_at
  );
exception when duplicate_object then null;
end $$;

-- A NOTE ON DELETES, because it changes how the client subscribes. With the
-- default replica identity (the primary key), a DELETE event carries only `id` —
-- no project_id. A subscription filtered on project_id therefore never sees a
-- deletion, and the list keeps showing a plan that is gone. Two ways out:
-- `replica identity full`, which is incompatible with the column list above and
-- would put the jsonb back on the wire, or an UNFILTERED subscription relying on
-- RLS to scope it to the user's own rows. The second is what src/lib/db.js does.


-- plan_revisions is deliberately NOT published: nothing on screen watches the
-- corpus, and it is the most write-heavy table here.

-- ===========================================================================
-- STORAGE — the `uploads` bucket (already created, public read)
--
-- PATHS ARE `<user-id>/<plan-id>/…`, and the first segment is the whole
-- security model: a policy compares folder[1] against auth.uid(), so a user can
-- only ever write inside their own prefix.
--
-- THE BUCKET IS PUBLIC, and that is a deliberate, limited trade. A public URL
-- is what lets the DXF be re-fetched and the snapshot be shown in an <img>
-- without minting signed URLs on every card. The consequence is that anyone
-- holding a full path can read that object — the paths contain two uuids and are
-- not enumerable, but this is not a secret. If drawings are ever confidential,
-- turn the bucket private and swap publicUrl() in src/lib/supabase.js for
-- createSignedUrl(); that is the only call site.
-- ===========================================================================

drop policy if exists "uploads: read" on storage.objects;
create policy "uploads: read" on storage.objects
  for select using (bucket_id = 'uploads');

drop policy if exists "uploads: write own folder" on storage.objects;
create policy "uploads: write own folder" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "uploads: update own folder" on storage.objects;
create policy "uploads: update own folder" on storage.objects
  for update to authenticated using (
    bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text
  ) with check (
    bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "uploads: delete own folder" on storage.objects;
create policy "uploads: delete own folder" on storage.objects
  for delete to authenticated using (
    bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text
  );
