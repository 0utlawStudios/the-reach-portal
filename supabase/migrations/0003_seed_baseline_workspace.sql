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
insert into workspace_members (workspace_id, user_id, role, status)
select
  '00000000-0000-0000-0000-000000000001'::uuid as workspace_id,
  u.id as user_id,
  case
    when tm.role::text = 'owner' then 'superadmin'
    when tm.role::text = 'admin' then 'admin'
    when tm.role::text = 'approver' then 'approver'
    when tm.role::text = 'creative_director' then 'creative_director'
    when tm.role::text = 'editor' then 'editor'
    when tm.role::text in ('viewer','member','guest') then 'viewer'
    else 'viewer'
  end as role,
  case
    when tm.status::text = 'active' then 'active'
    when tm.status::text = 'pending' then 'pending'
    when tm.status::text = 'suspended' then 'suspended'
    else 'active'
  end as status
from team_members tm
join auth.users u on lower(u.email) = lower(tm.email)
on conflict (workspace_id, user_id) do nothing;
