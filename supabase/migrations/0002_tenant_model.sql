-- 0002_tenant_model.sql
-- Introduces the workspace tenant model: workspaces + workspace_members.
-- Every domain row will later get workspace_id (see 0004).
-- Idempotent: safe to re-run.
-- Part of Workstream C (C1) of the security remediation.

create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  timezone text not null default 'Asia/Dubai',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- role uses the existing user_role enum directly so every value the app
-- already supports at baseline is automatically valid without schema churn.
-- Later role values are added in 0005_role_enum_reconcile.sql, so this
-- migration must not reference them before they exist on a fresh database.
create table if not exists workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role user_role not null,
  status text not null default 'pending' check (status in (
    'pending','active','suspended'
  )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index if not exists workspace_members_user_idx on workspace_members(user_id);
create index if not exists workspace_members_status_idx on workspace_members(workspace_id, status);

alter table workspaces enable row level security;
alter table workspace_members enable row level security;

-- Members of a workspace can read the workspace row.
drop policy if exists "workspaces_read" on workspaces;
create policy "workspaces_read" on workspaces
  for select using (
    id in (
      select workspace_id from workspace_members
      where user_id = auth.uid() and status = 'active'
    )
  );

-- Members of a workspace can read each other's membership rows for the same workspace.
drop policy if exists "workspace_members_read" on workspace_members;
create policy "workspace_members_read" on workspace_members
  for select using (
    workspace_id in (
      select workspace_id from workspace_members
      where user_id = auth.uid() and status = 'active'
    )
  );

-- Admin-class roles available in the baseline enum can update membership rows
-- in their workspace. Later hardening migrations expand this after 0005 adds
-- the additional role enum values.
drop policy if exists "workspace_members_write" on workspace_members;
create policy "workspace_members_write" on workspace_members
  for all using (
    workspace_id in (
      select workspace_id from workspace_members
      where user_id = auth.uid()
        and status = 'active'
        and role in ('owner','admin')
    )
  ) with check (
    workspace_id in (
      select workspace_id from workspace_members
      where user_id = auth.uid()
        and status = 'active'
        and role in ('owner','admin')
    )
  );
