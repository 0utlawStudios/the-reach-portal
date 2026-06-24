-- 0055_media_tenant_hardening.sql
-- Closes remaining media + tenant-boundary hardening gaps found in QA:
--   - v_publish_queue must not expose jobs across workspaces
--   - record_audit_event must not trust caller-supplied workspace_id blindly
--   - Brand Playbook is one row per workspace
--   - source_vault must be JSONB even on drifted legacy databases

-- Brand Playbook: keep the newest row if a drifted database already has
-- duplicates, then enforce one playbook per workspace.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (PARTITION BY workspace_id ORDER BY updated_at DESC, id DESC) AS rn
  FROM public.brand_playbook
)
DELETE FROM public.brand_playbook bp
USING ranked r
WHERE bp.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS brand_playbook_one_row_per_workspace_idx
  ON public.brand_playbook(workspace_id);

-- Legacy replay guard: source_vault must be JSONB for client object writes and
-- source-vault media lookups.
DO $$
DECLARE
  v_data_type TEXT;
BEGIN
  SELECT data_type
  INTO v_data_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'posts'
    AND column_name = 'source_vault';

  IF v_data_type IS NOT NULL AND v_data_type <> 'jsonb' THEN
    EXECUTE $alter$
      ALTER TABLE public.posts
      ALTER COLUMN source_vault TYPE jsonb
      USING CASE
        WHEN source_vault IS NULL THEN '{}'::jsonb
        WHEN btrim(source_vault::text) = '' THEN '{}'::jsonb
        ELSE source_vault::jsonb
      END
    $alter$;
  END IF;
END $$;

-- Publishing Queue: SECURITY DEFINER views can bypass table RLS. Keep the
-- admin monitoring surface, but include workspace_id and enforce membership in
-- the view itself.
DROP VIEW IF EXISTS public.v_publish_queue;

CREATE VIEW public.v_publish_queue
WITH (security_invoker = true)
AS
SELECT
  j.workspace_id,
  j.id              AS job_id,
  j.state,
  j.scheduled_at,
  j.next_retry_at,
  j.attempts,
  j.last_error,
  j.worker_id,
  j.claim_expires_at,
  p.id              AS post_id,
  p.title,
  p.stage,
  p.platforms,
  p.scheduled_timezone,
  p.posted_at,
  p.posted_urls,
  (now() - j.scheduled_at)                          AS overdue_by,
  (j.claim_expires_at IS NOT NULL
    AND j.claim_expires_at < now())                 AS claim_stuck
FROM public.publish_jobs j
JOIN public.posts p ON p.id = j.post_id
WHERE j.state IN ('pending', 'claimed', 'partial', 'failed')
  AND (
    auth.role() = 'service_role'
    OR public.is_active_workspace_member(j.workspace_id, ARRAY['superadmin','admin','owner'])
  )
ORDER BY j.scheduled_at ASC;

GRANT SELECT ON public.v_publish_queue TO authenticated;

COMMENT ON VIEW public.v_publish_queue IS
  'Tenant-scoped operator monitoring view for the publish queue. Read by the admin Publishing Queue panel in Settings.';

-- Audit RPC: authenticated clients may pass p_workspace_id, but only for a
-- workspace where they are active members. For post events, derive workspace
-- from the post row and reject mismatches.
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
  v_entity_workspace UUID;
  v_role TEXT;
  v_id UUID;
BEGIN
  IF p_entity_type = 'post' AND p_entity_id IS NOT NULL THEN
    SELECT workspace_id
    INTO v_entity_workspace
    FROM public.posts
    WHERE id = p_entity_id;

    IF v_entity_workspace IS NOT NULL THEN
      IF v_workspace IS NOT NULL AND v_workspace <> v_entity_workspace THEN
        RAISE EXCEPTION 'audit workspace does not match entity workspace'
          USING ERRCODE = '42501';
      END IF;
      v_workspace := v_entity_workspace;
    END IF;
  END IF;

  IF v_workspace IS NULL AND v_user IS NOT NULL THEN
    SELECT workspace_id
    INTO v_workspace
    FROM public.workspace_members
    WHERE user_id = v_user
      AND status = 'active'
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;

  IF v_user IS NOT NULL THEN
    SELECT role::TEXT
    INTO v_role
    FROM public.workspace_members
    WHERE user_id = v_user
      AND workspace_id = v_workspace
      AND status = 'active'
    LIMIT 1;

    IF v_workspace IS NULL OR v_role IS NULL THEN
      RAISE EXCEPTION 'audit workspace membership required'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Service-role/background calls have no auth.uid(). Preserve the existing
  -- baseline fallback for those trusted server contexts only.
  IF v_workspace IS NULL THEN
    v_workspace := '00000000-0000-0000-0000-000000000001'::uuid;
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
