-- 0013_column_drift.sql
-- Adds columns the code writes but the legacy setup files never created.
-- Idempotent: IF NOT EXISTS everywhere. Also ensures the signup_requests
-- table exists (the app writes to it via /api/team/request-access).
-- Closes the rest of finding #5 (schema drift) as a migration file.
-- Part of Workstream C (C5) of the security remediation.

-- posts columns referenced in src/lib/pipeline-context.tsx and elsewhere.
alter table posts add column if not exists source_vault text;
alter table posts add column if not exists asset_source text;
alter table posts add column if not exists license_file_id text;
alter table posts add column if not exists created_by text;
alter table posts add column if not exists hook text;

-- team_members columns referenced in the app.
alter table team_members add column if not exists phone text;

-- signup_requests table for the request-access flow.
-- IMPORTANT: if this table already exists from an older setup file
-- (e.g., supabase-setup-all.sql) without workspace_id, CREATE TABLE IF NOT
-- EXISTS is a no-op and the missing columns would not get added. The
-- explicit ALTER TABLE ADD COLUMN IF NOT EXISTS statements below bring
-- any pre-existing table up to spec.
create table if not exists signup_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade,
  name text not null,
  email text not null,
  phone text,
  company text,
  reason text,
  role text,
  status text not null default 'pending'
    check (status in ('pending','approved','rejected')),
  requested_by text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

-- Bring a pre-existing signup_requests table up to the expected schema.
alter table signup_requests add column if not exists workspace_id uuid;
alter table signup_requests add column if not exists phone text;
alter table signup_requests add column if not exists company text;
alter table signup_requests add column if not exists reason text;
alter table signup_requests add column if not exists role text;
alter table signup_requests add column if not exists requested_by text;
alter table signup_requests add column if not exists reviewed_by text;
alter table signup_requests add column if not exists reviewed_at timestamptz;

-- Add FK on workspace_id if missing. Idempotent via DO block.
do $$ begin
  alter table signup_requests add constraint signup_requests_workspace_id_fkey
    foreign key (workspace_id) references workspaces(id) on delete cascade;
exception when duplicate_object then null; end $$;

create index if not exists signup_requests_status_idx
  on signup_requests(status, created_at desc);
create index if not exists signup_requests_email_idx
  on signup_requests(email);
create index if not exists signup_requests_workspace_idx
  on signup_requests(workspace_id)
  where workspace_id is not null;

alter table signup_requests enable row level security;

-- Only admin-class can read signup requests.
drop policy if exists "signup_requests_select_admin" on signup_requests;
create policy "signup_requests_select_admin" on signup_requests for select
  using (
    workspace_id is null
    or is_active_workspace_member(workspace_id, array['superadmin','admin'])
  );

-- Inserts happen via service role from /api/team/request-access. No client
-- INSERT policy. Updates (approve/reject) likewise go through server routes.
