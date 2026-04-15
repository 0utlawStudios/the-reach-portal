-- 0004_workspace_id_columns.sql
-- Adds workspace_id to every domain table, backfills with the Ten80Ten baseline
-- workspace, converts to NOT NULL with FK, and indexes for hot queries.
-- Idempotent: safe to re-run.
-- Apply AFTER 0002_tenant_model.sql and 0003_seed_baseline_workspace.sql.
-- Part of Workstream C (C3) of the security remediation.

-- ─── Add nullable workspace_id columns ───

alter table posts add column if not exists workspace_id uuid;
alter table media_assets add column if not exists workspace_id uuid;
alter table post_comments add column if not exists workspace_id uuid;
alter table post_audit_logs add column if not exists workspace_id uuid;
alter table brand_playbook add column if not exists workspace_id uuid;

-- ─── Backfill every row with the baseline Ten80Ten workspace ───

update posts set workspace_id = '00000000-0000-0000-0000-000000000001'
  where workspace_id is null;
update media_assets set workspace_id = '00000000-0000-0000-0000-000000000001'
  where workspace_id is null;
update post_comments set workspace_id = '00000000-0000-0000-0000-000000000001'
  where workspace_id is null;
update post_audit_logs set workspace_id = '00000000-0000-0000-0000-000000000001'
  where workspace_id is null;
update brand_playbook set workspace_id = '00000000-0000-0000-0000-000000000001'
  where workspace_id is null;

-- ─── Enforce NOT NULL after backfill ───

alter table posts alter column workspace_id set not null;
alter table media_assets alter column workspace_id set not null;
alter table post_comments alter column workspace_id set not null;
alter table post_audit_logs alter column workspace_id set not null;
alter table brand_playbook alter column workspace_id set not null;

-- ─── Add foreign keys (idempotent via DO blocks) ───

do $$
begin
  alter table posts add constraint posts_workspace_id_fkey
    foreign key (workspace_id) references workspaces(id) on delete cascade;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table media_assets add constraint media_assets_workspace_id_fkey
    foreign key (workspace_id) references workspaces(id) on delete cascade;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table post_comments add constraint post_comments_workspace_id_fkey
    foreign key (workspace_id) references workspaces(id) on delete cascade;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table post_audit_logs add constraint post_audit_logs_workspace_id_fkey
    foreign key (workspace_id) references workspaces(id) on delete cascade;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table brand_playbook add constraint brand_playbook_workspace_id_fkey
    foreign key (workspace_id) references workspaces(id) on delete cascade;
exception when duplicate_object then null;
end $$;

-- ─── Indexes for hot queries ───

create index if not exists posts_workspace_idx on posts(workspace_id);
create index if not exists media_assets_workspace_idx on media_assets(workspace_id);
create index if not exists post_comments_workspace_idx on post_comments(workspace_id);
create index if not exists post_audit_logs_workspace_idx on post_audit_logs(workspace_id);
create index if not exists brand_playbook_workspace_idx on brand_playbook(workspace_id);
