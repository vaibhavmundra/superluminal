-- ===========================================================================
-- 0006_sharing.sql — a project, shown to somebody who does not own it.
--
-- TWO KINDS OF SHARE, AND THEY ARE NOT THE SAME MECHANISM.
--
--   project_shares       A NAMED PERSON, by email, with 'view' or 'edit'. This
--                        is a real grant: the row changes what RLS lets that
--                        account read and write, so the invitee uses the SAME
--                        screens the owner does — /dashboard, /projects/:id,
--                        /plans/:id — and the policies decide what they can do
--                        once they are there. No second app, no second viewer.
--
--   project_share_links  ANYBODY WITH THE URL, view only. This is NOT an RLS
--                        grant and deliberately so: a policy cannot see a token
--                        that lives in the address bar, and inventing a way for
--                        it to (a session variable, a claim) would mean a policy
--                        whose scope depends on something the client sets. So
--                        the token is redeemed SERVER-SIDE in api/share.js with
--                        the service key, exactly as api/admin.js redeems an
--                        admin's role, and the browser gets rows rather than
--                        permission. The link still requires a sign-in, because
--                        an anonymous reader has no session to hang a rate limit
--                        or an audit line on — see the header of api/share.js.
--
-- WHY THE EMAIL IS THE KEY AND NOT A USER ID. You share a project with somebody
-- who has not signed up yet — that is the ordinary case, not the edge one. A row
-- keyed on auth.users.id cannot be written until they exist, which would make
-- "invite a client" a two-step dance ending in "tell them to sign up first and
-- then tell me". So the grant is written against the address, and it starts
-- working the moment somebody signs in holding it. `invited_user` is filled in
-- afterwards as a convenience for the owner's list, and is NOT what the policies
-- match on — see share_role().
--
-- THE POLICIES BELOW REPLACE THE ONES IN 0001_init.sql for projects, plans and
-- plan_revisions. They are dropped and recreated rather than added alongside,
-- because two SELECT policies on one table OR together and the result is very
-- hard to read six months later. Everything here is `if not exists` / `drop
-- first`, so the file is safe to re-run.
-- ===========================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. the two tables
-- ---------------------------------------------------------------------------

create table if not exists public.project_shares (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects (id) on delete cascade,
  -- The PROJECT'S owner, denormalised for the same reason plans.owner is: every
  -- policy on this table is then an index probe rather than a join. Kept honest
  -- by the trigger below.
  owner         uuid not null references auth.users (id) on delete cascade,
  -- Lowercased on the way in — see the trigger. A case-sensitive grant is a
  -- support ticket about an invite that "did not arrive".
  email         text not null,
  -- Resolved once that address has an account. Nullable forever if they never
  -- sign up, which is fine: the grant is the email.
  invited_user  uuid references auth.users (id) on delete set null,
  role          text not null default 'view' check (role in ('view', 'edit')),
  -- SO THE INVITEE CAN SEE WHO INVITED THEM. `profiles` is readable only by its
  -- own subject (0001_init.sql) and widening that so a shared list can print a
  -- name would open every address in the database to anybody holding one share.
  -- One denormalised column, filled by a trigger, is the smaller hole: it
  -- discloses the owner's address to the person the owner deliberately invited.
  owner_email   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ONE GRANT PER ADDRESS PER PROJECT. Re-inviting somebody is a change of role,
-- not a second row — two rows saying 'view' and 'edit' would make share_role()'s
-- answer depend on which one it happened to read first.
--
-- PLAIN COLUMNS, NOT `lower(email)`, AND THAT IS FORCED BY THE CLIENT. Inviting
-- somebody who is already on the list must mean "change their role", which is an
-- upsert — and PostgREST infers the arbiter index from the column NAMES it is
-- given, so it cannot target an expression index. The case-insensitivity is
-- therefore enforced one step earlier instead: the BEFORE INSERT trigger
-- lowercases the address, and a BEFORE trigger runs before the conflict is
-- looked for, so `Client@X.com` and `client@x.com` collide exactly as intended.
create unique index if not exists project_shares_unique
  on public.project_shares (project_id, email);
-- Still worth having as a functional index: share_role() lowercases both sides
-- defensively, so this is the index that lookup can actually use.
create index if not exists project_shares_email_idx on public.project_shares (lower(email));
create index if not exists project_shares_user_idx  on public.project_shares (invited_user);
create index if not exists project_shares_owner_idx on public.project_shares (owner, created_at desc);

drop trigger if exists project_shares_touch on public.project_shares;
create trigger project_shares_touch before update on public.project_shares
  for each row execute function public.touch_updated_at();

create table if not exists public.project_share_links (
  -- 18 random bytes as url-safe base64: 24 characters, 144 bits. Long enough
  -- that guessing one is not a threat model, short enough to paste into a chat.
  token         text primary key
                default translate(encode(gen_random_bytes(18), 'base64'), '+/=', '-_'),
  -- ONE LIVE LINK PER PROJECT. "Regenerate" is a delete and an insert, which is
  -- what makes revoking meaningful: the old token stops resolving because the
  -- row is gone, not because a flag was set that some cached path might miss.
  project_id    uuid not null unique references public.projects (id) on delete cascade,
  owner         uuid not null references auth.users (id) on delete cascade,
  created_at    timestamptz not null default now()
);

create index if not exists project_share_links_owner_idx
  on public.project_share_links (owner, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. the triggers that keep the denormalised columns honest
-- ---------------------------------------------------------------------------

-- OWNER AND EMAIL COME FROM THE DATABASE, NOT FROM THE CLIENT. The insert in
-- src/lib/sharing.js sends neither; this overwrites them either way, for the
-- same reason plans_set_owner does — a client-supplied owner is a client claim,
-- and the whole point of the denormalised column is that the policies can trust
-- it.
create or replace function public.project_shares_fill()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  proj_owner uuid;
begin
  select p.owner into proj_owner from public.projects p where p.id = new.project_id;
  if proj_owner is null then
    raise exception 'project % does not exist', new.project_id;
  end if;
  new.owner := proj_owner;
  new.email := lower(btrim(new.email));
  if new.email = '' then raise exception 'an email address is required'; end if;
  -- NOBODY SHARES WITH THEMSELVES. It would produce a project that appears in
  -- both lists on the dashboard, and a share_role() of 'view' on your own
  -- project, which is the one way the policies below could take rights AWAY.
  select u.email into new.owner_email from auth.users u where u.id = proj_owner;
  if lower(coalesce(new.owner_email, '')) = new.email then
    raise exception 'that is your own address';
  end if;
  -- Best effort, and null is a perfectly good answer: they have not signed up.
  select u.id into new.invited_user from auth.users u where lower(u.email) = new.email;
  return new;
end $$;

drop trigger if exists project_shares_fill_cols on public.project_shares;
create trigger project_shares_fill_cols before insert or update on public.project_shares
  for each row execute function public.project_shares_fill();

create or replace function public.project_share_links_fill()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select p.owner into new.owner from public.projects p where p.id = new.project_id;
  if new.owner is null then
    raise exception 'project % does not exist', new.project_id;
  end if;
  return new;
end $$;

drop trigger if exists project_share_links_fill_cols on public.project_share_links;
create trigger project_share_links_fill_cols before insert on public.project_share_links
  for each row execute function public.project_share_links_fill();

-- A NEW ACCOUNT COLLECTS THE INVITES THAT WERE WAITING FOR IT. Not load-bearing
-- — share_role() matches on the address, so the grant already works — but the
-- owner's list wants to say "joined" rather than "invited", and a nullable
-- column that is only ever null is a column nobody trusts.
create or replace function public.attach_pending_shares()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.project_shares
     set invited_user = new.id
   where invited_user is null
     and lower(email) = lower(coalesce(new.email, ''));
  return new;
end $$;

drop trigger if exists on_auth_user_created_shares on auth.users;
create trigger on_auth_user_created_shares after insert on auth.users
  for each row execute function public.attach_pending_shares();

-- Anyone already signed up gets attached now.
update public.project_shares s
   set invited_user = u.id
  from auth.users u
 where s.invited_user is null and lower(u.email) = lower(s.email);

-- ---------------------------------------------------------------------------
-- 3. share_role() — the one function every policy below calls
--
-- SECURITY DEFINER, AND THAT IS THE LOAD-BEARING WORD. The policy on `projects`
-- has to ask "is there a share row for me on this project", and the policy on
-- `project_shares` has to ask "do I own the project this row is on". Written the
-- obvious way those two are mutually recursive and Postgres raises
-- "infinite recursion detected in policy for relation". A definer function runs
-- as its owner, so the select inside it does not re-enter RLS, and the recursion
-- never starts.
--
-- IT IS SAFE TO EXPOSE precisely because it takes a project id and returns only
-- the CALLER'S OWN role on it. There is no argument you can pass that makes it
-- talk about somebody else — auth.uid() and the JWT's email are the only inputs
-- it trusts, and neither is a parameter.
--
-- THE MATCH IS ON THE ADDRESS FIRST. `invited_user` is a convenience filled by a
-- trigger; the email in the JWT is what the grant was written against, and it is
-- what makes an invite work the very first time somebody signs in.
--
-- 'edit' WINS over 'view' if both somehow exist. The unique index makes that
-- impossible, and the order-by is there so that a future second grant path — a
-- team, an organisation — cannot quietly downgrade somebody.
-- ---------------------------------------------------------------------------
create or replace function public.share_role(p_project uuid)
returns text language sql stable security definer set search_path = public as $$
  select s.role
    from public.project_shares s
   where s.project_id = p_project
     and (s.invited_user = auth.uid()
          or (auth.jwt() ->> 'email') is not null
             and lower(s.email) = lower(auth.jwt() ->> 'email'))
   order by case s.role when 'edit' then 0 else 1 end
   limit 1
$$;

revoke all on function public.share_role(uuid) from public;
grant execute on function public.share_role(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. THE POLICIES, REWRITTEN.
--
-- Read every one of these as "owner, OR somebody the owner named". The shape is
-- the same in all of them and the only thing that varies is whether 'view' is
-- enough.
--
-- WHAT AN EDITOR MAY NOT DO, deliberately: rename or delete the project, delete
-- a plan, or manage the share list. Those are acts of ownership rather than acts
-- of design, and an "edit" grant that lets a client delete the building is not a
-- grant anybody would give twice. Adding a drawing and laying out the lighting
-- is the whole of what edit means here.
-- ---------------------------------------------------------------------------

alter table public.project_shares      enable row level security;
alter table public.project_share_links enable row level security;

-- --- projects --------------------------------------------------------------

drop policy if exists "projects are own" on public.projects;
drop policy if exists "projects are own or shared" on public.projects;
create policy "projects are own or shared" on public.projects
  for select to authenticated using (
    owner = auth.uid() or public.share_role(id) is not null
  );

-- insert / update / delete are unchanged from 0001 and stay owner-only. They are
-- restated here only so that this file is a complete picture of who may do what
-- to a project.
drop policy if exists "projects insert own" on public.projects;
create policy "projects insert own" on public.projects
  for insert to authenticated with check (owner = auth.uid());

drop policy if exists "projects update own" on public.projects;
create policy "projects update own" on public.projects
  for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());

drop policy if exists "projects delete own" on public.projects;
create policy "projects delete own" on public.projects
  for delete to authenticated using (owner = auth.uid());

-- --- plans -----------------------------------------------------------------

drop policy if exists "plans are own" on public.plans;
drop policy if exists "plans are own or shared" on public.plans;
create policy "plans are own or shared" on public.plans
  for select to authenticated using (
    owner = auth.uid() or public.share_role(project_id) is not null
  );

-- THE OWNER COLUMN IS NOT CHECKED ON WRITE, and 0001's note explains why: a
-- trigger overwrites it from the project, so a policy on it would be testing a
-- value the client does not control. What must be true is that the caller may
-- write into THIS PROJECT — and for a shared editor the row they create is owned
-- by the project's owner, which is exactly right. It is the owner's project.
drop policy if exists "plans insert into own project" on public.plans;
drop policy if exists "plans insert into a project i can edit" on public.plans;
create policy "plans insert into a project i can edit" on public.plans
  for insert to authenticated with check (
    exists (select 1 from public.projects p
             where p.id = project_id
               and (p.owner = auth.uid() or public.share_role(p.id) = 'edit'))
  );

drop policy if exists "plans update own" on public.plans;
drop policy if exists "plans update own or shared-edit" on public.plans;
create policy "plans update own or shared-edit" on public.plans
  for update to authenticated using (
    owner = auth.uid() or public.share_role(project_id) = 'edit'
  ) with check (
    exists (select 1 from public.projects p
             where p.id = project_id
               and (p.owner = auth.uid() or public.share_role(p.id) = 'edit'))
  );

-- DELETE STAYS OWNER-ONLY. See the note at the head of this section.
drop policy if exists "plans delete own" on public.plans;
create policy "plans delete own" on public.plans
  for delete to authenticated using (owner = auth.uid());

-- --- plan_revisions --------------------------------------------------------
--
-- Still append-only: there is no update policy and no delete policy, which is
-- how that is enforced. An editor's milestones belong in the corpus for the same
-- reason the owner's do — they are corrections a human made to a machine's
-- proposal, and who was holding the mouse does not change what they teach.

drop policy if exists "revisions are own" on public.plan_revisions;
drop policy if exists "revisions are own or shared" on public.plan_revisions;
create policy "revisions are own or shared" on public.plan_revisions
  for select to authenticated using (
    owner = auth.uid()
    or exists (select 1 from public.plans p
                where p.id = plan_id and public.share_role(p.project_id) is not null)
  );

drop policy if exists "revisions insert own plan" on public.plan_revisions;
drop policy if exists "revisions insert into a plan i can edit" on public.plan_revisions;
create policy "revisions insert into a plan i can edit" on public.plan_revisions
  for insert to authenticated with check (
    exists (select 1 from public.plans p
             where p.id = plan_id
               and (p.owner = auth.uid() or public.share_role(p.project_id) = 'edit'))
  );

-- --- project_shares --------------------------------------------------------
--
-- THE OWNER MANAGES THE LIST; AN INVITEE MAY READ THEIR OWN ROW AND NOTHING
-- ELSE. That second half is not a nicety — it is how the app knows whether to
-- draw an editor's panel or a viewer's, and reading it from the same table the
-- policies read is the only version that cannot disagree with them.
--
-- The select policy does NOT go through share_role(), on purpose: this table is
-- what that function reads, and a policy that called it would be circular in the
-- one place the definer trick cannot help — the function would return rows the
-- policy is still deciding about. The two clauses below are the same test,
-- written out.

drop policy if exists "shares readable by owner and invitee" on public.project_shares;
create policy "shares readable by owner and invitee" on public.project_shares
  for select to authenticated using (
    owner = auth.uid()
    or invited_user = auth.uid()
    or ((auth.jwt() ->> 'email') is not null
        and lower(email) = lower(auth.jwt() ->> 'email'))
  );

drop policy if exists "shares written by the project owner" on public.project_shares;
create policy "shares written by the project owner" on public.project_shares
  for insert to authenticated with check (
    exists (select 1 from public.projects p where p.id = project_id and p.owner = auth.uid())
  );

drop policy if exists "shares updated by the project owner" on public.project_shares;
create policy "shares updated by the project owner" on public.project_shares
  for update to authenticated using (owner = auth.uid()) with check (
    exists (select 1 from public.projects p where p.id = project_id and p.owner = auth.uid())
  );

-- AND REVOKED BY EITHER SIDE. The owner takes access away; the invitee walks
-- away from a project they never asked to be added to, which is the only way
-- "Leave" can work without an endpoint of its own.
drop policy if exists "shares deleted by owner or invitee" on public.project_shares;
create policy "shares deleted by owner or invitee" on public.project_shares
  for delete to authenticated using (
    owner = auth.uid()
    or invited_user = auth.uid()
    or ((auth.jwt() ->> 'email') is not null
        and lower(email) = lower(auth.jwt() ->> 'email'))
  );

-- --- project_share_links ---------------------------------------------------
--
-- OWNER ONLY, INCLUDING THE READ — and that looks wrong until you remember that
-- nobody else ever selects from this table. The link is redeemed by
-- api/share.js with the service key; the browser only ever sees a token because
-- it is in the URL it was given. A policy letting `authenticated` select by
-- token would turn the table into an enumerable list of every shared project.

drop policy if exists "share links are the owner's" on public.project_share_links;
create policy "share links are the owner's" on public.project_share_links
  for select to authenticated using (owner = auth.uid());

drop policy if exists "share links created by the project owner" on public.project_share_links;
create policy "share links created by the project owner" on public.project_share_links
  for insert to authenticated with check (
    exists (select 1 from public.projects p where p.id = project_id and p.owner = auth.uid())
  );

drop policy if exists "share links deleted by the owner" on public.project_share_links;
create policy "share links deleted by the owner" on public.project_share_links
  for delete to authenticated using (owner = auth.uid());

-- ---------------------------------------------------------------------------
-- 5. STORAGE — an editor writes into the OWNER'S folder.
--
-- This is the one place sharing does not fall out of the row policies, and it is
-- worth understanding before changing it. Paths are `<owner-id>/<plan-id>/…`
-- (see 0001_init.sql) and `plans.owner` is the PROJECT's owner even when a
-- shared editor created the row — which is correct, and which means the snapshot
-- an editor uploads lands under somebody else's uuid. The 0001 policy compares
-- folder[1] with auth.uid() and would refuse it.
--
-- So the second segment is used instead: it is a plan id, and a plan id is
-- enough to ask whether the caller may edit the project it belongs to. Reads
-- need nothing — the bucket is public-read by design.
--
-- THE CAST IS GUARDED. `folder[2]` is whatever somebody put in the path, and an
-- unguarded `::uuid` on it turns a malformed upload path into a 500 rather than
-- a refusal.
-- ---------------------------------------------------------------------------

create or replace function public.can_write_plan_object(object_name text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  seg text;
  pid uuid;
begin
  seg := (storage.foldername(object_name))[2];
  if seg is null or seg !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  then return false; end if;
  pid := seg::uuid;
  return exists (
    select 1 from public.plans p
     where p.id = pid and public.share_role(p.project_id) = 'edit'
  );
end $$;

revoke all on function public.can_write_plan_object(text) from public;
grant execute on function public.can_write_plan_object(text) to authenticated, service_role;

drop policy if exists "uploads: write own folder" on storage.objects;
create policy "uploads: write own folder" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'uploads' and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.can_write_plan_object(name)
    )
  );

drop policy if exists "uploads: update own folder" on storage.objects;
create policy "uploads: update own folder" on storage.objects
  for update to authenticated using (
    bucket_id = 'uploads' and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.can_write_plan_object(name)
    )
  ) with check (
    bucket_id = 'uploads' and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.can_write_plan_object(name)
    )
  );

-- Delete stays strictly own-folder. Removing somebody else's stored drawing is
-- not part of laying out lighting.

-- ---------------------------------------------------------------------------
-- 6. REALTIME
--
-- Nothing to add to the publication: the dashboard already subscribes to
-- `projects` and `plans`, and Supabase applies RLS to the change feed, so a
-- shared project's edits now arrive on the invitee's socket for free — by the
-- same policies that let them read the row in the first place.
--
-- `project_shares` is deliberately NOT published. A share is created a handful
-- of times in a project's life and the dialog that creates it already has the
-- answer in its hand.
-- ---------------------------------------------------------------------------
