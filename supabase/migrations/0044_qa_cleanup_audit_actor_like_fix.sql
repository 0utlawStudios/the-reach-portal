-- 0044_qa_cleanup_audit_actor_like_fix.sql
-- Follow-up to 0043: use a plain LIKE matcher for the exact qa-* cleanup
-- email shape so already-written production QA cleanup rows normalize too.

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
  AND metadata->>'details' LIKE 'Removed qa-%@example.com from team, workspace access, and auth';
