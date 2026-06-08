-- 0047_manual_posted_feature_flag.sql
-- Global emergency switch for temporarily allowing approver-class users to
-- move verified live Approved/Scheduled posts into Posted while n8n is blocked.

insert into public.feature_flags (name, enabled, metadata)
values (
  'manual_posted_moves',
  false,
  jsonb_build_object(
    'label', 'Manual Posted moves',
    'scope', 'the-reach',
    'reason', 'temporary fallback while n8n auto-publisher is inactive'
  )
)
on conflict (name) do nothing;
