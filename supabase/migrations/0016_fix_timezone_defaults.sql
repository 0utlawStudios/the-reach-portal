-- 0016_fix_timezone_defaults.sql
-- Change the default timezone from Asia/Dubai to America/Chicago (CST).
-- The Dubai fallback caused scheduled times to be stored as already-past
-- UTC timestamps, causing n8n to immediately publish posts upon approval.

-- Update existing workspaces that have no timezone or Dubai timezone
UPDATE workspaces
SET timezone = 'America/Chicago'
WHERE timezone IS NULL OR timezone = '' OR timezone = 'Asia/Dubai';

-- Update existing posts that have Dubai timezone set
UPDATE posts
SET scheduled_timezone = 'America/Chicago'
WHERE scheduled_timezone = 'Asia/Dubai';

-- Re-create create_publish_job_for_post with CST as the fallback
-- (replaces the version from 0014 — only the fallback timezone changes)
CREATE OR REPLACE FUNCTION create_publish_job_for_post(p_post_id uuid)
RETURNS publish_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_post record;
  v_timezone text;
  v_scheduled_at timestamptz;
  v_job publish_jobs;
BEGIN
  SELECT p.*, w.timezone AS workspace_timezone
  INTO v_post
  FROM posts p
  JOIN workspaces w ON w.id = p.workspace_id
  WHERE p.id = p_post_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'post % not found', p_post_id;
  END IF;

  IF v_post.stage::text <> 'approved_scheduled' THEN
    RAISE EXCEPTION 'post % is %, expected approved_scheduled', p_post_id, v_post.stage::text;
  END IF;

  -- CST is now the canonical fallback (was Asia/Dubai)
  v_timezone := COALESCE(NULLIF(v_post.scheduled_timezone, ''), NULLIF(v_post.workspace_timezone, ''), 'America/Chicago');
  v_scheduled_at := v_post.scheduled_at;

  IF v_scheduled_at IS NULL THEN
    IF v_post.scheduled_date IS NULL OR v_post.scheduled_time IS NULL THEN
      RAISE EXCEPTION 'post % has no scheduled_at or legacy schedule columns', p_post_id;
    END IF;
    v_scheduled_at := ((v_post.scheduled_date::date + v_post.scheduled_time::time) AT TIME ZONE v_timezone);
  END IF;

  UPDATE posts
  SET scheduled_at = v_scheduled_at,
      scheduled_timezone = v_timezone,
      updated_at = now()
  WHERE id = p_post_id;

  INSERT INTO publish_jobs (workspace_id, post_id, scheduled_at, state)
  VALUES (v_post.workspace_id, p_post_id, v_scheduled_at, 'pending')
  ON CONFLICT (post_id) DO UPDATE
    SET scheduled_at = excluded.scheduled_at,
        state = 'pending',
        claim_expires_at = null,
        worker_id = null,
        updated_at = now()
    WHERE publish_jobs.state IN ('pending', 'failed')
  RETURNING * INTO v_job;

  IF v_job.id IS NULL THEN
    SELECT * INTO v_job FROM publish_jobs WHERE post_id = p_post_id;
  END IF;

  INSERT INTO platform_publish_attempts (job_id, platform, idempotency_key)
  SELECT v_job.id, platform, concat(v_job.id::text, ':', platform)
  FROM unnest(COALESCE(v_post.platforms, '{}'::text[])) AS platform
  WHERE platform IN ('instagram', 'facebook', 'linkedin', 'tiktok', 'youtube')
  ON CONFLICT (job_id, platform) DO NOTHING;

  RETURN v_job;
END $$;

REVOKE ALL ON FUNCTION create_publish_job_for_post(uuid) FROM public;
GRANT EXECUTE ON FUNCTION create_publish_job_for_post(uuid) TO service_role;
