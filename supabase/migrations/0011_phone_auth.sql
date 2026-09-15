-- ===========================================================================
-- 0011_phone_auth.sql — the login became a phone number.
--
-- WHAT ACTUALLY CHANGED, IN ONE SENTENCE: `auth.users.email` used to be there
-- for everybody and is now null for everybody new, and four things in this
-- schema were quietly built on it.
--
-- Signing in is now a phone number and an SMS code (Supabase's native phone
-- provider, Twilio Verify behind it — the app never talks to Twilio). So a new
-- account arrives carrying `auth.users.phone` and NOTHING ELSE: no address, no
-- name, not even the `split_part(email, '@', 1)` that used to make a passable
-- first display name. The address is collected later, at the first export, and
-- lands on `public.profiles.email` — see src/lib/profile.js and ContactGate.jsx.
--
-- THE FOUR THINGS THAT BROKE, all of which read an address that is now null:
--
--   handle_new_user()       wrote `new.email` into the profile row. Null now,
--                           and the name fallback went with it.
--   project_shares_fill()   reads the OWNER's address out of auth.users to
--                           stamp `owner_email` and to refuse a self-share.
--   attach_pending_shares() matched a brand-new user against waiting invites
--                           by `new.email` — which no longer exists at the
--                           moment that trigger fires, and does exist an hour
--                           later when the export gate collects it.
--   share_role()            THE LOAD-BEARING ONE. Every policy on projects,
--                           plans and shares calls it, and it matched the
--                           invite against `auth.jwt() ->> 'email'`. For a
--                           phone account that claim is absent, so every
--                           invite silently granted nothing.
--
-- THE FIX IS ONE IDEA APPLIED FOUR TIMES: the address now comes from
-- `public.profiles.email`, with the JWT's claim preferred where there is one.
-- `my_email()` is that idea as a function, so the rule lives in one place
-- rather than in four subtly different subqueries.
--
-- ⚠ READ THIS BEFORE YOU SHARE A PROJECT WITH SOMEBODY YOU DO NOT TRUST.
--
-- A grant is keyed on an address, and that address is now SELF-ASSERTED. Under
-- email login the address was proved by possession — you could not sign in
-- without receiving the code sent to it. Under phone login it is a string typed
-- into a form, and this project has `mailer_autoconfirm` on, so nothing else
-- verifies it either. The consequence is exact and worth stating plainly:
-- somebody who knows that an invite is waiting for alice@studio.com can sign up
-- with any phone number, type that address at the export gate, and collect the
-- invite.
--
-- THE UNIQUE INDEX IN STEP 3 IS HALF OF THE ANSWER and is the half that can be
-- done in SQL: one address belongs to one account, so an address that is
-- already somebody's cannot be taken, and the only exposure left is an invite
-- sent to an address that has never signed up. The other half is a policy
-- decision rather than a migration — turn OFF auto-confirm in
-- Authentication → Providers → Email, which makes a changed address prove
-- itself before the JWT carries it, and then narrow `my_email()` to the JWT
-- claim alone. That is a deliberate trade against the export gate's whole
-- design (see profile.js), so it is left as a choice and not made here.
--
-- Run it in the Supabase SQL editor, or `supabase db push`. Idempotent.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. what the two identity columns now mean
--
-- Neither column is added or altered — both already exist (0001 and 0008). What
-- changed is which one is the ACCOUNT and which one is the contact detail, and
-- a comment is the only place that distinction can be written down where the
-- next person reads it.
-- ---------------------------------------------------------------------------

comment on column public.profiles.phone is
  'THE LOGIN, mirrored from auth.users.phone by sync_profile_identity() — not a '
  'field anybody types any more. E.164: a leading +, a country code, digits. It '
  'was the WhatsApp number collected at the first export until 0011; the one row '
  'that still holds a hand-typed number from that era is harmless, because '
  'nothing authenticates against THIS copy. auth.users.phone is the account.';

comment on column public.profiles.email is
  'THE CONTACT ADDRESS, collected at the first export (ContactGate.jsx) rather '
  'than at sign-up, because a phone account never has one. Lowercased at the '
  'single point of entry — share_role() compares it with lower() on both sides, '
  'so a stored capital is a grant that silently never matches. Two things need '
  'it and both fail quietly without it: a Razorpay receipt, and a share invite.';

-- ---------------------------------------------------------------------------
-- 2. a new account, when there is no address to name it with
--
-- `split_part(email, '@', 1)` was the old first display name and it produced
-- "vaibhav" from an address. A phone account has nothing equivalent — a number
-- is not a name — so full_name is left NULL and the client falls back through
-- name → email → phone for the label and the avatar letter. See the `handle`
-- computed in src/lib/auth.jsx.
--
-- NULL AND NOT THE NUMBER, deliberately. Writing the phone into full_name would
-- make every new user appear to have "chosen" +919876543210 as their name, and
-- the rename box in the account menu would open pre-filled with it.
-- ---------------------------------------------------------------------------

-- THE `+` IS NOT OPTIONAL, AND GOTRUE DOES NOT STORE IT.
--
-- This is the sort of thing you only find by looking at a real row. Supabase
-- keeps `auth.users.phone` as bare digits — `919680659423` — while every other
-- phone value in this system is E.164 with a leading plus, which is what
-- `profiles.phone` is documented to hold and what `normalisePhone` in
-- src/lib/profile.js will accept. Mirroring the column across verbatim writes a
-- number that LOOKS right in the admin list, fails `normalisePhone` (no `+` and
-- no `00`, so it reads as a national number with no country), and makes a
-- `tel:` href ambiguous about which country it belongs to.
--
-- Normalising in one function rather than at each of the three call sites is the
-- point: the two triggers and the backfill below all need the same answer, and
-- three copies of a string expression is how two of them end up different.
--
-- IT IS DELIBERATELY NOT A VALIDATOR. Anything GoTrue accepted as a phone number
-- is a phone number — this adds the plus and nothing else, because a migration
-- that silently dropped a row's number because it disliked the shape would be a
-- user who cannot sign in and no record of why.
create or replace function public.e164(raw text)
returns text language sql immutable as $$
  select nullif('+' || ltrim(btrim(coalesce(raw, '')), '+'), '+')
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, phone, full_name)
  values (
    new.id,
    nullif(btrim(lower(coalesce(new.email, ''))), ''),
    public.e164(new.phone),
    nullif(split_part(coalesce(new.email, ''), '@', 1), '')
  )
  on conflict (id) do nothing;
  return new;
end $$;

-- THE NUMBER CHANGES AFTER SIGN-UP TOO, and that is not a hypothetical: it is
-- how the accounts that predate this migration get a phone at all. `node
-- tools/link-phone.mjs` sets auth.users.phone through the admin API, and
-- without this trigger the projection would keep saying null forever while the
-- user signed in perfectly well.
--
-- COALESCE ON BOTH COLUMNS, so this can only ever FILL a value and never blank
-- one. An email change on an account that carries an old hand-typed WhatsApp
-- number must not wipe it, and a phone link must not wipe the contact address.
create or replace function public.sync_profile_identity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.profiles
     set phone = coalesce(public.e164(new.phone), phone),
         email = coalesce(nullif(btrim(lower(coalesce(new.email, ''))), ''), email)
   where id = new.id;
  return new;
end $$;

drop trigger if exists on_auth_user_identity on auth.users;
create trigger on_auth_user_identity after update of phone, email on auth.users
  for each row execute function public.sync_profile_identity();

-- Everybody who already has a number on the auth row gets it mirrored now.
update public.profiles p
   set phone = public.e164(u.phone)
  from auth.users u
 where u.id = p.id
   and p.phone is null
   and public.e164(u.phone) is not null;

-- ---------------------------------------------------------------------------
-- 3. one address, one account
--
-- THE HALF OF THE SELF-ASSERTION PROBLEM THAT SQL CAN SOLVE — see the warning
-- in the header. A share grant is keyed on an address and the address is now
-- typed rather than proved, so the guarantee worth having is that an address
-- which already belongs to somebody cannot be claimed by anybody else. Without
-- it, two accounts can hold alice@studio.com and both collect her invites.
--
-- PARTIAL, because the column is null for every phone account until its owner
-- reaches the first export, and a plain unique index would be satisfied by
-- those nulls anyway — the predicate is here to say so out loud rather than
-- because Postgres needs it.
--
-- ON THE EXPRESSION AND NOT THE COLUMN, matching normaliseEmail in
-- src/lib/profile.js. `Alice@studio.com` and `alice@studio.com` are one address
-- everywhere else in this system; an index that disagreed would let the one
-- thing it exists to prevent straight through.
--
-- IT CAN REJECT A WRITE, and the export dialog names it — see `friendly` in
-- ContactGate.jsx. There were no duplicates when this was written.
-- ---------------------------------------------------------------------------

create unique index if not exists profiles_email_unique
  on public.profiles (lower(btrim(email)))
  where email is not null and btrim(email) <> '';

-- ---------------------------------------------------------------------------
-- 4. my_email() — the caller's address, wherever it now lives
--
-- SECURITY DEFINER for the same reason share_role() is: it reads `profiles`,
-- and share_role() is called FROM the policy on `projects`, which is reached
-- from the policy on `project_shares`. A non-definer read here would re-enter
-- RLS and reproduce the recursion 0006 went to some trouble to break.
--
-- THE JWT CLAIM WINS WHERE THERE IS ONE, and the order is the whole point. For
-- the accounts that predate phone login the claim is present and was PROVED —
-- they could not have signed in without receiving a code at it — so preferring
-- it keeps every existing grant working exactly as it did, and keeps those
-- users out of the self-assertion hole described in the header. The profile row
-- is the fallback, and it is the only answer a phone account has.
--
-- IT TAKES NO ARGUMENT, which is what makes it safe to expose. There is nothing
-- you can pass that makes it talk about somebody else.
-- ---------------------------------------------------------------------------

create or replace function public.my_email()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    nullif(btrim(lower(auth.jwt() ->> 'email')), ''),
    (select nullif(btrim(lower(p.email)), '')
       from public.profiles p where p.id = auth.uid())
  )
$$;

revoke all on function public.my_email() from public;
grant execute on function public.my_email() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. share_role(), rebuilt on my_email()
--
-- IDENTICAL TO 0006's IN EVERY OTHER RESPECT — same definer reasoning, same
-- 'edit' beats 'view' order-by, same single-row limit. The only edit is the
-- address expression, and it is the edit that makes an invite reach a phone
-- account at all.
-- ---------------------------------------------------------------------------

create or replace function public.share_role(p_project uuid)
returns text language sql stable security definer set search_path = public as $$
  select s.role
    from public.project_shares s
   where s.project_id = p_project
     and (s.invited_user = auth.uid()
          or (public.my_email() is not null
              and lower(s.email) = public.my_email()))
   order by case s.role when 'edit' then 0 else 1 end
   limit 1
$$;

revoke all on function public.share_role(uuid) from public;
grant execute on function public.share_role(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. the owner's address on a new share row
--
-- TWO DIFFERENT ADDRESSES COME OUT OF THIS, and conflating them was the bug
-- waiting to happen. `owner_email` is a DISPLAY value — the dashboard's "shared
-- by" line — and should say something rather than nothing, so it falls back to
-- the owner's phone number when there is no address yet. The SELF-SHARE CHECK
-- is a correctness value and must only ever compare addresses: a phone number
-- in that comparison could never match an email, which would be harmless, but
-- the day it is changed to compare "identifiers" it would stop being harmless.
-- ---------------------------------------------------------------------------

create or replace function public.project_shares_fill()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  proj_owner  uuid;
  owner_addr  text;
  owner_label text;
begin
  select p.owner into proj_owner from public.projects p where p.id = new.project_id;
  if proj_owner is null then
    raise exception 'project % does not exist', new.project_id;
  end if;
  new.owner := proj_owner;
  new.email := lower(btrim(new.email));
  if new.email = '' then raise exception 'an email address is required'; end if;

  -- The owner's real address, from wherever it lives — the auth row for the
  -- accounts that predate phone login, the profile row for everybody since.
  select coalesce(
           nullif(btrim(lower(coalesce(u.email, ''))), ''),
           nullif(btrim(lower(coalesce(pr.email, ''))), '')
         ),
         nullif(btrim(coalesce(u.phone, '')), '')
    into owner_addr, owner_label
    from auth.users u
    left join public.profiles pr on pr.id = u.id
   where u.id = proj_owner;

  -- NOBODY SHARES WITH THEMSELVES. It would produce a project that appears in
  -- both lists on the dashboard, and a share_role() of 'view' on your own
  -- project, which is the one way the policies could take rights AWAY.
  if owner_addr is not null and owner_addr = new.email then
    raise exception 'that is your own address';
  end if;
  new.owner_email := coalesce(owner_addr, owner_label);

  -- Best effort, and null is a perfectly good answer: they have not signed up.
  -- Both identity columns are searched for the same reason my_email() consults
  -- both — the invitee may be from either era.
  select u.id into new.invited_user
    from auth.users u
    left join public.profiles pr on pr.id = u.id
   where lower(coalesce(u.email, '')) = new.email
      or lower(coalesce(pr.email, '')) = new.email
   limit 1;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 7. an invite is collected when the ADDRESS arrives, not when the account does
--
-- THE TRIGGER MOVED FROM auth.users TO public.profiles, and that move is the
-- whole repair. Under email login the two moments were the same one: the row
-- was created carrying the address, so firing on insert into auth.users caught
-- it. Under phone login they are an hour apart — the account exists from the
-- first SMS code, and the address turns up at the first export — so the old
-- trigger fired at the one moment there was nothing to match on and never fired
-- again.
--
-- `after insert or update of email` CATCHES BOTH ERAS. handle_new_user() writes
-- the profile row with the address already in it for anybody signing up with
-- one, which is an INSERT; the export gate later fills it in for a phone
-- account, which is an UPDATE. The old auth.users trigger is dropped rather
-- than left alongside: it is now strictly the narrower of the two, and two
-- triggers doing one job is how they drift.
--
-- NOT LOAD-BEARING, as 0006 said and is still true — share_role() matches on
-- the address, so the grant already works. This is what lets the owner's list
-- say "joined" rather than "invited".
-- ---------------------------------------------------------------------------

create or replace function public.attach_pending_shares()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if nullif(btrim(coalesce(new.email, '')), '') is null then return new; end if;
  update public.project_shares
     set invited_user = new.id
   where invited_user is null
     and lower(email) = lower(btrim(new.email));
  return new;
end $$;

drop trigger if exists on_auth_user_created_shares on auth.users;
drop trigger if exists profiles_attach_shares on public.profiles;
create trigger profiles_attach_shares
  after insert or update of email on public.profiles
  for each row execute function public.attach_pending_shares();

-- Anyone whose address is already on their profile gets attached now.
update public.project_shares s
   set invited_user = p.id
  from public.profiles p
 where s.invited_user is null
   and nullif(btrim(coalesce(p.email, '')), '') is not null
   and lower(p.email) = lower(s.email);
