-- 0038_reach_launch_audit_actor_cleanup.sql
-- The launch cleanup removed cloned/test Ten80Ten users from The Reach. Those
-- entries describe a system cleanup and should not display as Aldridge's
-- personal action in the client-facing audit log.

UPDATE public.audit_log_v2
SET metadata = jsonb_set(
  COALESCE(metadata, '{}'::jsonb),
  '{user_name}',
  to_jsonb('SYSTEM'::text),
  true
)
WHERE action = 'member_removed'
  AND metadata->>'details' LIKE 'Reach launch cleanup removed %'
  AND COALESCE(metadata->>'user_name', '') <> 'SYSTEM';
