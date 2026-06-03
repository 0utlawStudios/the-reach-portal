-- 0039_reach_cleanup_audit_actor_normalization.sql
-- Earlier Reach launch cleanup runs used a shorter "Removed <email>..."
-- detail string for cloned/test Ten80Ten users. These are system cleanup
-- events, not Aldridge's personal member removals.

UPDATE public.audit_log_v2
SET metadata = jsonb_set(
  COALESCE(metadata, '{}'::jsonb),
  '{user_name}',
  to_jsonb('SYSTEM'::text),
  true
)
WHERE action = 'member_removed'
  AND COALESCE(metadata->>'user_name', '') <> 'SYSTEM'
  AND metadata->>'details' IN (
    'Removed alex@ten80ten.com from team, workspace access, and auth',
    'Removed carlo@ten80ten.com from team, workspace access, and auth',
    'Removed christer@ten80ten.com from team, workspace access, and auth',
    'Removed hanes@ten80ten.com from team, workspace access, and auth',
    'Removed muaaz.ten80ten@gmail.com from team, workspace access, and auth',
    'Removed shang.ten80ten@gmail.com from team, workspace access, and auth'
  );
