-- 0009_audit_log_v2.sql
-- Adds audit_log_v2: a generalized append-only audit table with actor identity
-- pulled from auth.uid() via a security-definer record_audit_event function.
-- The legacy post_audit_logs table is preserved permanently per the project
-- memory rule "NEVER drop or truncate audit logs". Both tables coexist; new
-- code should write to audit_log_v2, old code continues to write to
-- post_audit_logs until migration is complete.
--
-- Depends on 0007_rls_v2.sql for the is_active_workspace_member helper.
-- Part of Workstream G (G5) of the security remediation.

create table if not exists audit_log_v2 (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_role text,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  correlation_id uuid,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_log_v2_workspace_idx
  on audit_log_v2(workspace_id, created_at desc);
create index if not exists audit_log_v2_actor_idx
  on audit_log_v2(actor_user_id, created_at desc);
create index if not exists audit_log_v2_entity_idx
  on audit_log_v2(entity_type, entity_id);
create index if not exists audit_log_v2_correlation_idx
  on audit_log_v2(correlation_id)
  where correlation_id is not null;

alter table audit_log_v2 enable row level security;

-- Workspace members can READ audit events for their own workspace.
drop policy if exists "audit_log_v2_select_v2" on audit_log_v2;
create policy "audit_log_v2_select_v2" on audit_log_v2 for select
  using (is_active_workspace_member(workspace_id, null));

-- No INSERT / UPDATE / DELETE policies. Writes happen only through
-- record_audit_event() below, which runs as security definer and derives
-- the actor identity from auth.uid() rather than trusting client input.
-- Service role still bypasses RLS for admin cleanup.

-- ─── record_audit_event helper ───

create or replace function record_audit_event(
  p_entity_type text,
  p_action text,
  p_entity_id uuid default null,
  p_workspace_id uuid default null,
  p_metadata jsonb default null,
  p_correlation_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_role text;
  v_workspace uuid;
  v_audit_id uuid;
begin
  v_actor := auth.uid();
  v_workspace := p_workspace_id;

  -- If workspace_id not provided, derive from the actor's first active membership.
  if v_workspace is null and v_actor is not null then
    select workspace_id into v_workspace
    from workspace_members
    where user_id = v_actor and status = 'active'
    limit 1;
  end if;

  -- Get the actor's role in that workspace.
  if v_actor is not null and v_workspace is not null then
    select role into v_role
    from workspace_members
    where user_id = v_actor and workspace_id = v_workspace
    limit 1;
  end if;

  insert into audit_log_v2(
    workspace_id, actor_user_id, actor_role,
    entity_type, entity_id, action,
    correlation_id, metadata
  )
  values (
    v_workspace, v_actor, v_role,
    p_entity_type, p_entity_id, p_action,
    p_correlation_id, p_metadata
  )
  returning id into v_audit_id;

  return v_audit_id;
end $$;

revoke all on function record_audit_event(text, text, uuid, uuid, jsonb, uuid) from public;
grant execute on function record_audit_event(text, text, uuid, uuid, jsonb, uuid)
  to authenticated, service_role;
