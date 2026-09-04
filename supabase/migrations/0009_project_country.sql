-- ===========================================================================
-- 0009_project_country.sql — where the building is.
--
-- ONE COLUMN, AND IT DECIDES WHAT A SWITCHBOARD IS MADE OF. A plate in India is
-- a frame of 1/2/3/4/6/8/12/18 MODULES holding 6A/16A/20A/32A switches, where a
-- socket is two modules wide and a fan regulator is another two. The same plate
-- in the United States is a 1-to-4 GANG box holding 15A/20A devices, one gang
-- each, and nothing about the first sentence survives the crossing. See
-- src/lib/switchboards.js, which holds the registry this value keys into.
--
-- ON `projects` AND NOT ON `plans`, because it is a property of the JOB. A
-- project is one building or one client's work, and its floors do not each sit
-- in a different country — putting it on the plan would mean answering it once
-- per drawing and would make two sheets of one flat disagree about what a
-- socket costs.
--
-- FREE TEXT AND NOT AN ENUM, and not a check constraint either. The list of
-- countries this app knows how to specify lives in a JavaScript module the
-- browser and the tools share, and adding the third one should be an entry in
-- that table rather than a migration. `countryFor` is deliberately forgiving
-- about what it finds here — code, name or alias, any case — precisely because
-- this column can be written by hand.
--
-- NULL IS ALLOWED AND MEANS INDIA. Every project that exists today has no
-- answer, and back-filling a guess for all of them is worse than reading the
-- default in one place: see DEFAULT_COUNTRY. A NOT NULL with a default would
-- also make "nobody said" and "somebody said India" indistinguishable, and the
-- first of those is a thing worth being able to ask about later.
--
-- NO NEW POLICIES. "projects update own" from 0001 already covers it — this is
-- a column on a row the owner already writes.
--
-- Run it in the Supabase SQL editor, or `supabase db push`. Idempotent.
-- ===========================================================================

alter table public.projects
  add column if not exists country text;

comment on column public.projects.country is
  'Where the building is, as an ISO 3166-1 alpha-2 code — IN, US. Read by '
  'src/lib/switchboards.js to decide the module sizes, switch ratings and board '
  'sizes a switchboard on this project is composed from. Free text rather than '
  'an enum because the list of supported countries lives in that module and '
  'grows by an entry rather than by a migration; countryFor() also accepts the '
  'full name and common aliases, case-insensitively. NULL means nobody said, '
  'which is read as India (DEFAULT_COUNTRY).';
