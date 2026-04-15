-- 0001_feature_flags.sql
-- Introduces the feature_flags table used to gate risky cutovers in
-- workstreams B through H. All flags ship disabled.

create table if not exists feature_flags (
  name text primary key,
  enabled boolean not null default false,
  metadata jsonb,
  updated_at timestamptz not null default now()
);

insert into feature_flags (name, enabled) values
  ('rls_v2', false),
  ('server_auth_v2', false),
  ('server_rpc_writes', false),
  ('drive_auth_v2', false),
  ('publish_v2', false),
  ('media_v2', false),
  ('audit_v2', false),
  ('content_validation_v2', false)
on conflict (name) do nothing;

alter table feature_flags enable row level security;

drop policy if exists "feature_flags_read" on feature_flags;
create policy "feature_flags_read" on feature_flags
  for select using (true);
