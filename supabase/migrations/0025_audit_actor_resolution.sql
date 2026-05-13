-- 0025_audit_actor_resolution.sql
-- Fixes "Unknown" rows in the audit trail.
--
-- Root cause (two independent bugs):
--   1. The audit_post_stage_change() trigger (migration 0015) writes
--      stage_changed rows with actor_user_id set but metadata.user_name
--      missing. The UI's audit.ts only reads metadata.user_name, so it
--      shows "Unknown" even though the actor IS known.
--   2. Server-side API routes (notification senders) write rows with
--      actor_user_id = NULL because they run under service_role. They
--      embed the actor name in metadata.movedBy or metadata.approvedBy
--      instead — but the UI fallback chain doesn't read those keys.
--
-- This migration:
--   a) Updates the stage-change trigger to also merge user_name into
--      metadata at insert time.
--   b) Backfills existing audit_log_v2 rows whose actor_user_id is set
--      but metadata.user_name is missing.
--   c) Adds public.v_audit_log_with_actor — a view that exposes a
--      resolved actor_name column (joins auth.users → team_members).
--
-- Strictly additive. No drops. Safe to apply on a live DB.

-- ─── a) Harden the trigger ──────────────────────────────────────────────

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
    -- Resolve the actor's display name from team_members via auth.users.email.
    -- Falls back to null silently — the trigger must never block the UPDATE.
    SELECT tm.name INTO v_user_name
    FROM auth.users au
    JOIN public.team_members tm ON lower(tm.email) = lower(au.email)
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

-- ─── b) Backfill historical rows ────────────────────────────────────────
--
-- Add metadata.user_name to every existing row that has actor_user_id set
-- but no metadata.user_name. Idempotent — only writes when missing.

UPDATE public.audit_log_v2 a
SET metadata = COALESCE(a.metadata, '{}'::jsonb) || jsonb_build_object('user_name', sub.name)
FROM (
  SELECT al.id, tm.name
  FROM public.audit_log_v2 al
  JOIN auth.users au ON au.id = al.actor_user_id
  JOIN public.team_members tm ON lower(tm.email) = lower(au.email)
  WHERE al.actor_user_id IS NOT NULL
    AND (al.metadata IS NULL OR (al.metadata->>'user_name') IS NULL OR (al.metadata->>'user_name') = '')
) sub
WHERE a.id = sub.id;

-- ─── c) Resolved-actor view ─────────────────────────────────────────────
--
-- Exposes a single actor_name column that resolves via the fallback chain:
--   1. metadata.user_name (now populated by the trigger + backfill above)
--   2. metadata.movedBy (set by server-side API routes that move a post)
--   3. metadata.approvedBy (set by approval notifications)
--   4. metadata.changedBy (legacy)
--   5. team_members.name via auth.users.email if actor_user_id is set
--   6. actor_role
--   7. NULL — UI renders "Unknown" only when ALL of the above fail.
--
-- The view runs with the view owner's permissions (security_invoker=false
-- by default), so authenticated users can SELECT without needing access
-- to auth.users directly.

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
    (
      SELECT tm.name
      FROM auth.users au
      JOIN public.team_members tm ON lower(tm.email) = lower(au.email)
      WHERE au.id = a.actor_user_id
      LIMIT 1
    ),
    a.actor_role
  ) AS actor_name
FROM public.audit_log_v2 a;

GRANT SELECT ON public.v_audit_log_with_actor TO authenticated;

COMMENT ON VIEW public.v_audit_log_with_actor IS
  'audit_log_v2 enriched with a resolved actor_name (user_name > movedBy > approvedBy > changedBy > team_members.name > actor_role). UI should prefer this view over audit_log_v2 for display.';
