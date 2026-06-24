-- 0057_feature_flags_composite_primary_key.sql
-- Promote the workspace/name unique index from 0056 to the table primary key
-- so feature_flags remains addressable by Supabase tooling after becoming
-- workspace-scoped.

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.feature_flags'::regclass
      and conname = 'feature_flags_pkey'
  ) then
    alter table public.feature_flags
      add constraint feature_flags_pkey
      primary key using index feature_flags_workspace_name_unique_idx;
  end if;
end $$;
