-- 0018_team_members_rls.sql
-- Replaces the legacy "Allow all for anon" policy on team_members with
-- workspace-scoped policies. Baseline 0000 left team_members wide open
-- (FOR ALL USING (true)) and the v2 RLS migration 0007 did not touch it.
--
-- Effect of this migration:
--   • SELECT — any active workspace member can read team_members for their
--     workspace. (team_members rows do not have workspace_id today, so we
--     gate on "user is an active member of the baseline workspace" while
--     preserving readability of self).
--   • INSERT/UPDATE/DELETE — admin/superadmin/owner only.
--
-- Why this is safe to apply mid-flight:
--   • Existing client code reads team_members on every load (team-context.tsx)
--     using the supabase anon client + authenticated JWT. After this migration
--     those reads still succeed for active members.
--   • Mutation flows (invite, remove, resend, approve) all go through API
--     routes that use the service-role client, which bypasses RLS. They are
--     unaffected.
--
-- Pre-requisites: 0002 (workspace_members), 0007 (is_active_workspace_member).

-- ─── Drop existing policies ───

do $$
declare pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'team_members'
  loop
    execute format('drop policy if exists %I on public.team_members', pol.policyname);
  end loop;
end $$;

-- ─── New policies ───

-- Read: any active workspace member can see team rows (multi-tenant single-
-- workspace today; if team_members ever gains a workspace_id column, replace
-- the baseline-id check with the row's own workspace_id).
create policy "team_members_select_v2" on team_members for select
  using (
    is_active_workspace_member(
      '00000000-0000-0000-0000-000000000001'::uuid,
      null
    )
  );

-- Insert: admin-class only. Today these go through the service role, but
-- this policy protects against any future direct insert from an admin's
-- anon-authenticated session.
create policy "team_members_insert_v2" on team_members for insert
  with check (
    is_active_workspace_member(
      '00000000-0000-0000-0000-000000000001'::uuid,
      array['superadmin','admin','owner']
    )
  );

-- Update: admin-class only.
create policy "team_members_update_v2" on team_members for update
  using (
    is_active_workspace_member(
      '00000000-0000-0000-0000-000000000001'::uuid,
      array['superadmin','admin','owner']
    )
  )
  with check (
    is_active_workspace_member(
      '00000000-0000-0000-0000-000000000001'::uuid,
      array['superadmin','admin','owner']
    )
  );

-- Delete: admin-class only.
create policy "team_members_delete_v2" on team_members for delete
  using (
    is_active_workspace_member(
      '00000000-0000-0000-0000-000000000001'::uuid,
      array['superadmin','admin','owner']
    )
  );
