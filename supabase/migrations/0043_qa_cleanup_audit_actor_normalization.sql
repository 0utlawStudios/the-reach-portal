-- 0043_qa_cleanup_audit_actor_normalization.sql
-- Production QA creates short-lived qa-* team rows to prove invite/setup
-- cleanup contracts. Those removals are automation cleanup, not a personal
-- Aldridge action, so the client-facing audit actor should read SYSTEM.

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
  AND metadata->>'details' ~ '^Removed qa-(invite|request)-[0-9]+@example\\.com from team, workspace access, and auth$';
