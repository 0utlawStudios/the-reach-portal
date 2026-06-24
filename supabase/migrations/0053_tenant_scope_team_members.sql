-- 0053_tenant_scope_team_members.sql
-- Make team_members tenant-scoped. The historical table was a global team
-- directory, which blocks real multitenant use because the same email/profile
-- could not safely exist in two workspaces.

ALTER TABLE public.team_members
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE;

UPDATE public.team_members
SET workspace_id = '00000000-0000-0000-0000-000000000001'::uuid
WHERE workspace_id IS NULL;

ALTER TABLE public.team_members
  ALTER COLUMN workspace_id SET DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,
  ALTER COLUMN workspace_id SET NOT NULL;

ALTER TABLE public.team_members
  DROP CONSTRAINT IF EXISTS team_members_email_key;

DROP INDEX IF EXISTS public.team_members_email_lower_unique_idx;

CREATE UNIQUE INDEX IF NOT EXISTS team_members_workspace_email_lower_unique_idx
  ON public.team_members (workspace_id, lower(email));

CREATE INDEX IF NOT EXISTS team_members_workspace_status_role_idx
  ON public.team_members (workspace_id, status, role);

CREATE INDEX IF NOT EXISTS team_members_workspace_lower_email_idx
  ON public.team_members (workspace_id, lower(email));

-- Replace baseline-only RLS with row workspace policies.
DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'team_members'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.team_members', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "team_members_select_v3" ON public.team_members FOR SELECT
  USING (public.is_active_workspace_member(workspace_id, NULL));

CREATE POLICY "team_members_insert_v3" ON public.team_members FOR INSERT
  WITH CHECK (
    public.is_active_workspace_member(workspace_id, ARRAY['superadmin','admin','owner'])
  );

CREATE POLICY "team_members_update_v3" ON public.team_members FOR UPDATE
  USING (
    public.is_active_workspace_member(workspace_id, ARRAY['superadmin','admin','owner'])
  )
  WITH CHECK (
    public.is_active_workspace_member(workspace_id, ARRAY['superadmin','admin','owner'])
  );

CREATE POLICY "team_members_delete_v3" ON public.team_members FOR DELETE
  USING (
    public.is_active_workspace_member(workspace_id, ARRAY['superadmin','admin','owner'])
  );

-- Keep audit actor resolution workspace-local once duplicate emails are legal.
CREATE OR REPLACE FUNCTION public.audit_post_stage_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_user_name text;
BEGIN
  IF old.stage IS DISTINCT FROM new.stage THEN
    SELECT tm.name INTO v_user_name
    FROM auth.users au
    JOIN public.team_members tm
      ON lower(tm.email) = lower(au.email)
     AND tm.workspace_id = new.workspace_id
    WHERE au.id = auth.uid()
    LIMIT 1;

    INSERT INTO public.audit_log_v2 (
      workspace_id,
      actor_user_id,
      entity_type,
      entity_id,
      action,
      metadata
    ) VALUES (
      new.workspace_id,
      auth.uid(),
      'post',
      new.id,
      'stage_changed',
      jsonb_build_object(
        'from_stage', old.stage,
        'to_stage',   new.stage,
        'title',      new.title,
        'user_name',  v_user_name
      )
    );
  END IF;
  RETURN new;
END;
$func$;

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
 AND tm.workspace_id = a.workspace_id
WHERE auth.role() = 'service_role'
   OR public.is_active_workspace_member(a.workspace_id, NULL);

GRANT SELECT ON public.v_audit_log_with_actor TO authenticated;

DROP VIEW IF EXISTS public.v_user_presence_summary;

CREATE OR REPLACE VIEW public.v_user_presence_summary AS
WITH last_audit AS (
  SELECT workspace_id, actor_user_id AS auth_user_id, MAX(created_at) AS audit_last
  FROM public.audit_log_v2
  WHERE actor_user_id IS NOT NULL
  GROUP BY workspace_id, actor_user_id
)
SELECT
  tm.workspace_id        AS workspace_id,
  tm.id                 AS team_member_id,
  tm.name               AS full_name,
  tm.email              AS email,
  au.id                 AS auth_user_id,
  up.last_seen_at       AS presence_last_seen,
  up.last_active_at     AS presence_last_active,
  la.audit_last         AS audit_last,
  au.last_sign_in_at    AS auth_last_sign_in,
  GREATEST(
    COALESCE(up.last_seen_at, '-infinity'::timestamptz),
    COALESCE(la.audit_last, '-infinity'::timestamptz),
    COALESCE(au.last_sign_in_at, '-infinity'::timestamptz)
  )                     AS best_known_seen
FROM public.team_members tm
LEFT JOIN auth.users au ON lower(au.email) = lower(tm.email)
LEFT JOIN public.user_presence up ON up.user_id = au.id
LEFT JOIN last_audit la
  ON la.auth_user_id = au.id
 AND la.workspace_id = tm.workspace_id
WHERE auth.role() = 'service_role'
   OR public.is_active_workspace_member(tm.workspace_id, NULL);

GRANT SELECT ON public.v_user_presence_summary TO authenticated;

COMMENT ON COLUMN public.team_members.workspace_id IS
  'Tenant/workspace owner for this team profile. Email uniqueness is per workspace.';
