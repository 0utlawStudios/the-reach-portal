-- 0030_supabase_io_hardening.sql
-- Reduce Disk IO pressure without upgrading compute.
--
-- Fixes observed production hot spots from Supabase Observability:
--   • recursive workspace/workspace_members policies causing slow/500 reads
--   • slow presence summary hydration
--   • legacy post_audit_logs still attached to Realtime
--   • workspace member lookups without the exact composite index the app uses

-- ─── Targeted indexes for the exact app paths ───────────────────────────

CREATE INDEX IF NOT EXISTS workspace_members_user_status_workspace_idx
  ON public.workspace_members(user_id, status, workspace_id);

CREATE INDEX IF NOT EXISTS team_members_lower_email_idx
  ON public.team_members(LOWER(email));

-- ─── RLS: replace recursive workspace policies with SECURITY DEFINER helper ───

DROP POLICY IF EXISTS "workspaces_read" ON public.workspaces;
DROP POLICY IF EXISTS "workspaces_update_admins" ON public.workspaces;

CREATE POLICY "workspaces_read" ON public.workspaces
  FOR SELECT TO authenticated
  USING (public.is_active_workspace_member(id, NULL));

CREATE POLICY "workspaces_update_admins" ON public.workspaces
  FOR UPDATE TO authenticated
  USING (public.is_active_workspace_member(id, ARRAY['superadmin','admin','owner']))
  WITH CHECK (public.is_active_workspace_member(id, ARRAY['superadmin','admin','owner']));

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'workspace_members'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.workspace_members', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "workspace_members_select_v2" ON public.workspace_members
  FOR SELECT TO authenticated
  USING (public.is_active_workspace_member(workspace_id, NULL));

CREATE POLICY "workspace_members_insert_v2" ON public.workspace_members
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_active_workspace_member(workspace_id, ARRAY['superadmin','admin','owner'])
  );

CREATE POLICY "workspace_members_update_v2" ON public.workspace_members
  FOR UPDATE TO authenticated
  USING (public.is_active_workspace_member(workspace_id, ARRAY['superadmin','admin','owner']))
  WITH CHECK (public.is_active_workspace_member(workspace_id, ARRAY['superadmin','admin','owner']));

CREATE POLICY "workspace_members_delete_v2" ON public.workspace_members
  FOR DELETE TO authenticated
  USING (public.is_active_workspace_member(workspace_id, ARRAY['superadmin','admin','owner']));

-- The Studio UI used to surface ai_generation_jobs RLS failures as 500s.
-- Keep the policy on the same SECURITY DEFINER helper as the rest of the app.
DROP POLICY IF EXISTS "ai_jobs_select_members" ON public.ai_generation_jobs;
CREATE POLICY "ai_jobs_select_members" ON public.ai_generation_jobs
  FOR SELECT TO authenticated
  USING (public.is_active_workspace_member(workspace_id, NULL));

-- ─── Presence summary: aggregate audit once instead of per-row subqueries ───

CREATE OR REPLACE VIEW public.v_user_presence_summary AS
WITH last_audit AS (
  SELECT actor_user_id AS auth_user_id, MAX(created_at) AS audit_last
  FROM public.audit_log_v2
  WHERE actor_user_id IS NOT NULL
  GROUP BY actor_user_id
)
SELECT
  tm.id                AS team_member_id,
  tm.name              AS full_name,
  tm.email             AS email,
  au.id                AS auth_user_id,
  up.last_seen_at      AS presence_last_seen,
  up.last_active_at    AS presence_last_active,
  la.audit_last        AS audit_last,
  au.last_sign_in_at   AS auth_last_sign_in,
  GREATEST(
    COALESCE(up.last_seen_at, '-infinity'::timestamptz),
    COALESCE(la.audit_last, '-infinity'::timestamptz),
    COALESCE(au.last_sign_in_at, '-infinity'::timestamptz)
  )                    AS best_known_seen
FROM public.team_members tm
LEFT JOIN auth.users au ON LOWER(au.email) = LOWER(tm.email)
LEFT JOIN public.user_presence up ON up.user_id = au.id
LEFT JOIN last_audit la ON la.auth_user_id = au.id;

GRANT SELECT ON public.v_user_presence_summary TO authenticated;

COMMENT ON VIEW public.v_user_presence_summary IS
  'Joined view of team_members + auth.users + user_presence + aggregated audit signal. '
  'Read by /api/presence/diag and the team UI hydration path.';

-- ─── Realtime: remove legacy audit table that no current client consumes ───

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'post_audit_logs'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.post_audit_logs;
  END IF;
END $$;
