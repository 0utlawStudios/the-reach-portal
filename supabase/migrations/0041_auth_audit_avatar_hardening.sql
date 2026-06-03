-- 0041_auth_audit_avatar_hardening.sql
-- Root hardening for The Reach invite/request lifecycle:
--   • lower-case email identity rows so Auth, team, and request lookups match
--   • prevent duplicate pending access requests inside the baseline workspace
--   • force audit rows to carry workspace scope and expose only workspace rows
--   • remove anonymous write access to the public avatar bucket

-- Email identity must be canonical before lower(email) uniqueness is enforced.
UPDATE public.team_members
SET email = lower(trim(email))
WHERE email <> lower(trim(email));

UPDATE public.signup_requests
SET email = lower(trim(email))
WHERE email <> lower(trim(email));

CREATE UNIQUE INDEX IF NOT EXISTS team_members_email_lower_unique_idx
  ON public.team_members (lower(email));

CREATE UNIQUE INDEX IF NOT EXISTS signup_requests_pending_lower_email_workspace_uidx
  ON public.signup_requests (workspace_id, lower(email))
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS signup_requests_workspace_lower_email_idx
  ON public.signup_requests (workspace_id, lower(email));

-- Single-tenant clone: historical service-role audit rows without an actor
-- context still belong to the baseline workspace.
ALTER TABLE public.audit_log_v2
  ALTER COLUMN workspace_id SET DEFAULT '00000000-0000-0000-0000-000000000001'::uuid;

UPDATE public.audit_log_v2
SET workspace_id = '00000000-0000-0000-0000-000000000001'::uuid
WHERE workspace_id IS NULL;

ALTER TABLE public.audit_log_v2
  ALTER COLUMN workspace_id SET NOT NULL;

-- Keep the existing RPC contract, but make server/service-role calls safe by
-- defaulting workspace scope to the baseline workspace when no actor context is
-- available.
CREATE OR REPLACE FUNCTION public.record_audit_event(
  p_entity_type TEXT,
  p_action TEXT,
  p_entity_id UUID DEFAULT NULL,
  p_workspace_id UUID DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL,
  p_correlation_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_workspace UUID := p_workspace_id;
  v_role TEXT;
  v_id UUID;
BEGIN
  IF v_workspace IS NULL AND v_user IS NOT NULL THEN
    SELECT workspace_id, role::TEXT
    INTO v_workspace, v_role
    FROM public.workspace_members
    WHERE user_id = v_user
      AND status = 'active'
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;

  IF v_workspace IS NULL THEN
    v_workspace := '00000000-0000-0000-0000-000000000001'::uuid;
  END IF;

  IF v_user IS NOT NULL AND v_workspace IS NOT NULL AND v_role IS NULL THEN
    SELECT role::TEXT
    INTO v_role
    FROM public.workspace_members
    WHERE user_id = v_user
      AND workspace_id = v_workspace
      AND status = 'active'
    LIMIT 1;
  END IF;

  INSERT INTO public.audit_log_v2 (
    workspace_id,
    actor_user_id,
    actor_role,
    entity_type,
    entity_id,
    action,
    metadata,
    correlation_id
  )
  VALUES (
    v_workspace,
    v_user,
    v_role,
    p_entity_type,
    p_entity_id,
    p_action,
    COALESCE(p_metadata, '{}'::jsonb),
    p_correlation_id
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_audit_event(TEXT, TEXT, UUID, UUID, JSONB, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_audit_event(TEXT, TEXT, UUID, UUID, JSONB, UUID)
  TO authenticated, service_role;

-- The app reads audit rows through this view. Keep auth.users/team label
-- resolution, but explicitly scope rows to active workspace members. Service
-- role remains allowed for health/ops verification.
CREATE OR REPLACE VIEW public.v_audit_log_with_actor AS
SELECT
  a.id,
  a.workspace_id,
  a.actor_user_id,
  a.actor_role,
  a.entity_type,
  a.entity_id,
  a.action,
  a.correlation_id,
  a.metadata,
  a.created_at,
  COALESCE(
    NULLIF(a.metadata->>'user_name', ''),
    NULLIF(a.metadata->>'movedBy', ''),
    NULLIF(a.metadata->>'approvedBy', ''),
    NULLIF(a.metadata->>'changedBy', ''),
    NULLIF(tm.name, ''),
    NULLIF(au.email, ''),
    a.actor_role,
    'SYSTEM'
  ) AS actor_name,
  au.email AS actor_email
FROM public.audit_log_v2 a
LEFT JOIN auth.users au
  ON au.id = a.actor_user_id
LEFT JOIN public.team_members tm
  ON lower(tm.email) = lower(au.email)
WHERE auth.role() = 'service_role'
   OR public.is_active_workspace_member(a.workspace_id, NULL);

GRANT SELECT ON public.v_audit_log_with_actor TO authenticated;

-- Public reads stay because avatars are public URLs. Writes must be
-- authenticated and user-path scoped. Revision attachments get their own
-- user-scoped kickback prefix because legacy UI uses the avatars bucket for
-- those temporary proof files.
DROP POLICY IF EXISTS "Allow uploads avatars" ON storage.objects;
DROP POLICY IF EXISTS "Allow updates avatars" ON storage.objects;
DROP POLICY IF EXISTS "Allow deletes avatars" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated own avatar uploads" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated own avatar updates" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated own avatar deletes" ON storage.objects;

CREATE POLICY "Authenticated own avatar uploads" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] IN ('profiles', 'kickback')
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

CREATE POLICY "Authenticated own avatar updates" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] IN ('profiles', 'kickback')
    AND (storage.foldername(name))[2] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] IN ('profiles', 'kickback')
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

CREATE POLICY "Authenticated own avatar deletes" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] IN ('profiles', 'kickback')
    AND (storage.foldername(name))[2] = auth.uid()::text
  );
