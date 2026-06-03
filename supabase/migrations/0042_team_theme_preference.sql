-- 0042_team_theme_preference.sql
-- The Reach defaults to light mode, with dark mode only as an explicit user
-- preference. The client already reads/writes team_members.theme_preference;
-- this migration binds that setting to the production schema so app load does
-- not emit PostgREST 400s for a missing column.

alter table public.team_members
  add column if not exists theme_preference text;

update public.team_members
set theme_preference = 'light'
where theme_preference is null
   or theme_preference not in ('light', 'dark');

alter table public.team_members
  alter column theme_preference set default 'light',
  alter column theme_preference set not null;

alter table public.team_members
  drop constraint if exists team_members_theme_preference_check;

alter table public.team_members
  add constraint team_members_theme_preference_check
  check (theme_preference in ('light', 'dark'));
