-- 0045_reach_cleanup_audit_system_role.sql
-- Canonicalize automated Reach launch/test cleanup removals as system-owned
-- audit rows at the database layer. Earlier migrations normalized the display
-- metadata; this also sets actor_role so raw audit surfaces cannot attribute
-- these cleanup events to Aldridge or another human actor.

UPDATE public.audit_log_v2
SET metadata = jsonb_set(
    COALESCE(metadata, '{}'::jsonb),
    '{user_name}',
    to_jsonb('SYSTEM'::text),
    true
  ),
  actor_user_id = NULL,
  actor_role = 'system'
WHERE action = 'member_removed'
  AND (
    metadata->>'details' LIKE 'Reach launch cleanup removed %'
    OR metadata->>'details' IN (
      'Removed alex@ten80ten.com from team, workspace access, and auth',
      'Removed carlo@ten80ten.com from team, workspace access, and auth',
      'Removed christer@ten80ten.com from team, workspace access, and auth',
      'Removed hanes@ten80ten.com from team, workspace access, and auth',
      'Removed muaaz.ten80ten@gmail.com from team, workspace access, and auth',
      'Removed shang.ten80ten@gmail.com from team, workspace access, and auth'
    )
    OR metadata->>'details' LIKE 'Removed qa-%@example.com from team, workspace access, and auth'
  )
  AND (
    actor_user_id IS NOT NULL
    OR COALESCE(actor_role, '') <> 'system'
    OR COALESCE(metadata->>'user_name', '') <> 'SYSTEM'
  );
