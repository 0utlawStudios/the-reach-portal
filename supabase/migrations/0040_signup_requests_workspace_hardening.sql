-- 0040_signup_requests_workspace_hardening.sql
-- The Reach is a single-tenant clone. Access requests must belong to the
-- baseline workspace, not a nullable global bucket.

UPDATE public.signup_requests
SET workspace_id = '00000000-0000-0000-0000-000000000001'
WHERE workspace_id IS NULL;

ALTER TABLE public.signup_requests
  ALTER COLUMN workspace_id SET DEFAULT '00000000-0000-0000-0000-000000000001',
  ALTER COLUMN workspace_id SET NOT NULL;

DROP POLICY IF EXISTS "signup_requests_select_admin" ON public.signup_requests;
CREATE POLICY "signup_requests_select_admin" ON public.signup_requests FOR SELECT
  USING (
    is_active_workspace_member(workspace_id, array['superadmin','admin'])
  );

CREATE INDEX IF NOT EXISTS signup_requests_workspace_created_idx
  ON public.signup_requests(workspace_id, created_at DESC);
