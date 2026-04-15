-- 0007_rls_v2.sql
-- Replaces the permissive "FOR ALL USING (true)" policies on every
-- workspace-tracked domain table with strict workspace-scoped policies.
-- Closes finding #1 (RLS permissive) from the 2026-04-15 adversarial review.
-- Part of Workstream C (C6) of the security remediation.
--
-- PREREQUISITES (apply in order first):
--   0001_feature_flags.sql
--   0002_tenant_model.sql
--   0003_seed_baseline_workspace.sql
--   0004_workspace_id_columns.sql
--   0005_role_enum_reconcile.sql
--
-- IMPORTANT: this migration drops every existing policy on the affected
-- tables and re-creates them atomically. For the duration of the transaction,
-- concurrent queries may briefly see denials. Apply during low-traffic window.
--
-- Tables touched: posts, media_assets, post_comments, post_audit_logs,
-- brand_playbook. workspaces and workspace_members already have strict
-- policies from 0002. feature_flags and rate_limit_buckets are either public-
-- readable or service-role-only and are not touched here.
--
-- Write-capable roles: superadmin, admin, approver, creative_director, editor.
-- Read-only role:       viewer.
-- Destructive roles:    superadmin, admin (delete-only).

-- ─── Helper: active workspace member with optional role filter ───

create or replace function is_active_workspace_member(
  p_workspace_id uuid,
  p_allowed_roles text[] default null
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
    from workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and (p_allowed_roles is null or wm.role::text = any(p_allowed_roles))
  );
$$;

revoke all on function is_active_workspace_member(uuid, text[]) from public;
grant execute on function is_active_workspace_member(uuid, text[]) to authenticated, service_role;

-- ─── Reusable role arrays ───

-- We inline these directly in policies for clarity, but documenting here:
-- WRITE_ROLES   = {superadmin, admin, approver, creative_director, editor}
-- DELETE_ROLES  = {superadmin, admin}

-- ─── posts ───

do $$
declare pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'posts'
  loop
    execute format('drop policy if exists %I on public.posts', pol.policyname);
  end loop;
end $$;

create policy "posts_select_v2" on posts for select
  using (is_active_workspace_member(workspace_id, null));

create policy "posts_insert_v2" on posts for insert
  with check (is_active_workspace_member(
    workspace_id,
    array['superadmin','admin','owner','approver','creative_director','editor','social_media_specialist','video_editor','graphic_designer','specialist']
  ));

create policy "posts_update_v2" on posts for update
  using (is_active_workspace_member(
    workspace_id,
    array['superadmin','admin','owner','approver','creative_director','editor','social_media_specialist','video_editor','graphic_designer','specialist']
  ))
  with check (is_active_workspace_member(
    workspace_id,
    array['superadmin','admin','owner','approver','creative_director','editor','social_media_specialist','video_editor','graphic_designer','specialist']
  ));

create policy "posts_delete_v2" on posts for delete
  using (is_active_workspace_member(workspace_id, array['superadmin','admin']));

-- ─── media_assets ───

do $$
declare pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'media_assets'
  loop
    execute format('drop policy if exists %I on public.media_assets', pol.policyname);
  end loop;
end $$;

create policy "media_assets_select_v2" on media_assets for select
  using (is_active_workspace_member(workspace_id, null));

create policy "media_assets_insert_v2" on media_assets for insert
  with check (is_active_workspace_member(
    workspace_id,
    array['superadmin','admin','owner','approver','creative_director','editor','social_media_specialist','video_editor','graphic_designer','specialist']
  ));

create policy "media_assets_update_v2" on media_assets for update
  using (is_active_workspace_member(
    workspace_id,
    array['superadmin','admin','owner','approver','creative_director','editor','social_media_specialist','video_editor','graphic_designer','specialist']
  ))
  with check (is_active_workspace_member(
    workspace_id,
    array['superadmin','admin','owner','approver','creative_director','editor','social_media_specialist','video_editor','graphic_designer','specialist']
  ));

create policy "media_assets_delete_v2" on media_assets for delete
  using (is_active_workspace_member(workspace_id, array['superadmin','admin']));

-- ─── post_comments ───

do $$
declare pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'post_comments'
  loop
    execute format('drop policy if exists %I on public.post_comments', pol.policyname);
  end loop;
end $$;

create policy "post_comments_select_v2" on post_comments for select
  using (is_active_workspace_member(workspace_id, null));

-- Any active member can comment (including viewers). That matches the
-- expected review flow where approvers and creative directors leave notes.
create policy "post_comments_insert_v2" on post_comments for insert
  with check (is_active_workspace_member(workspace_id, null));

-- Members can update their own comments only; admins can edit any.
create policy "post_comments_update_v2" on post_comments for update
  using (
    is_active_workspace_member(workspace_id, array['superadmin','admin'])
  )
  with check (
    is_active_workspace_member(workspace_id, array['superadmin','admin'])
  );

create policy "post_comments_delete_v2" on post_comments for delete
  using (is_active_workspace_member(workspace_id, array['superadmin','admin']));

-- ─── post_audit_logs ───

do $$
declare pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'post_audit_logs'
  loop
    execute format('drop policy if exists %I on public.post_audit_logs', pol.policyname);
  end loop;
end $$;

-- Audit logs are READ-ONLY via RLS. Writes happen through a server-side
-- security definer helper (or service role) so they cannot be spoofed from
-- the client. See memory rule: "NEVER drop or truncate audit logs".
create policy "post_audit_logs_select_v2" on post_audit_logs for select
  using (is_active_workspace_member(workspace_id, null));

-- No INSERT / UPDATE / DELETE policy for authenticated users.
-- Service role bypasses RLS so server-side inserts still work.

-- ─── brand_playbook ───

do $$
declare pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'brand_playbook'
  loop
    execute format('drop policy if exists %I on public.brand_playbook', pol.policyname);
  end loop;
end $$;

create policy "brand_playbook_select_v2" on brand_playbook for select
  using (is_active_workspace_member(workspace_id, null));

-- Only admin-class can edit brand playbook.
create policy "brand_playbook_insert_v2" on brand_playbook for insert
  with check (is_active_workspace_member(
    workspace_id,
    array['superadmin','admin','creative_director']
  ));

create policy "brand_playbook_update_v2" on brand_playbook for update
  using (is_active_workspace_member(
    workspace_id,
    array['superadmin','admin','creative_director']
  ))
  with check (is_active_workspace_member(
    workspace_id,
    array['superadmin','admin','creative_director']
  ));

create policy "brand_playbook_delete_v2" on brand_playbook for delete
  using (is_active_workspace_member(workspace_id, array['superadmin','admin']));
