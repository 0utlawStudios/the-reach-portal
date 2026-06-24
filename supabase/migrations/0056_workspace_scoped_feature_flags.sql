-- 0056_workspace_scoped_feature_flags.sql
-- Feature flags were originally global. Multitenant behavior requires the same
-- flag name to be configurable per workspace, with existing rows preserved for
-- the current single-tenant baseline workspace.

alter table public.feature_flags
  add column if not exists workspace_id uuid;

update public.feature_flags
set workspace_id = '00000000-0000-0000-0000-000000000001'::uuid
where workspace_id is null;

alter table public.feature_flags
  alter column workspace_id set default '00000000-0000-0000-0000-000000000001'::uuid,
  alter column workspace_id set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.feature_flags'::regclass
      and conname = 'feature_flags_workspace_id_fkey'
  ) then
    alter table public.feature_flags
      add constraint feature_flags_workspace_id_fkey
      foreign key (workspace_id)
      references public.workspaces(id)
      on delete cascade;
  end if;
end $$;

alter table public.feature_flags
  drop constraint if exists feature_flags_pkey;

create unique index if not exists feature_flags_workspace_name_unique_idx
  on public.feature_flags(workspace_id, name);

drop policy if exists "feature_flags_read" on public.feature_flags;
create policy "feature_flags_read" on public.feature_flags
  for select
  using (public.is_active_workspace_member(workspace_id, null));
