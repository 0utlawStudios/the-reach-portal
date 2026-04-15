-- 0003_seed_baseline_workspace.sql
-- Seeds the baseline Ten80Ten workspace and copies existing team_members rows
-- into workspace_members, keyed by matching auth.users.email.
-- Idempotent: ON CONFLICT DO NOTHING on both inserts.
-- Part of Workstream C (C2) of the security remediation.

-- Baseline workspace UUID is a constant so every later migration can reference it.
-- Chose a zero-padded sentinel UUID for clarity. Do not reuse for other workspaces.

insert into workspaces (id, name, slug, timezone)
values (
  '00000000-0000-0000-0000-000000000001',
  'Ten80Ten',
  'ten80ten',
  'Asia/Dubai'
)
on conflict (slug) do nothing;

-- Copy team_members into workspace_members where an auth.users row exists for the email.
-- Rows in team_members without a matching auth.users entry are skipped; they are
-- typically stale invites or external references.
--
-- workspace_members.role is now the user_role enum, so we can just pass tm.role
-- through untouched. Every legitimate production role (owner/admin/editor/viewer/
-- superadmin/approver/creative_director/social_media_specialist/video_editor/
-- graphic_designer/specialist/technician) is preserved 1:1.
insert into workspace_members (workspace_id, user_id, role, status)
select
  '00000000-0000-0000-0000-000000000001'::uuid as workspace_id,
  u.id as user_id,
  tm.role as role,
  case
    when tm.status::text = 'active' then 'active'
    when tm.status::text in ('pending','invited') then 'pending'
    when tm.status::text in ('suspended','removed','inactive','deactivated') then 'suspended'
    else 'pending'
  end as status
from team_members tm
join auth.users u on lower(u.email) = lower(tm.email)
on conflict (workspace_id, user_id) do nothing;
