-- 0059_publish_job_requeue_reset.sql
-- Re-approving or re-queuing a failed publish job must make it claimable
-- again. The 0016 function reset state/claim fields, but left attempts,
-- last_error, and next_retry_at intact, so a "pending" job could still be
-- skipped forever by the 0026 claimer.

CREATE OR REPLACE FUNCTION public.create_publish_job_for_post(p_post_id uuid)
RETURNS public.publish_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_post record;
  v_timezone text;
  v_scheduled_at timestamptz;
  v_job public.publish_jobs;
BEGIN
  SELECT p.*, w.timezone AS workspace_timezone
  INTO v_post
  FROM public.posts p
  JOIN public.workspaces w ON w.id = p.workspace_id
  WHERE p.id = p_post_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'post % not found', p_post_id;
  END IF;

  IF v_post.stage::text <> 'approved_scheduled' THEN
    RAISE EXCEPTION 'post % is %, expected approved_scheduled', p_post_id, v_post.stage::text;
  END IF;

  v_timezone := COALESCE(NULLIF(v_post.scheduled_timezone, ''), NULLIF(v_post.workspace_timezone, ''), 'America/Chicago');
  v_scheduled_at := v_post.scheduled_at;

  IF v_scheduled_at IS NULL THEN
    IF v_post.scheduled_date IS NULL OR v_post.scheduled_time IS NULL THEN
      RAISE EXCEPTION 'post % has no scheduled_at or legacy schedule columns', p_post_id;
    END IF;
    v_scheduled_at := ((v_post.scheduled_date::date + v_post.scheduled_time::time) AT TIME ZONE v_timezone);
  END IF;

  UPDATE public.posts
  SET scheduled_at = v_scheduled_at,
      scheduled_timezone = v_timezone,
      updated_at = now()
  WHERE id = p_post_id;

  INSERT INTO public.publish_jobs (workspace_id, post_id, scheduled_at, state)
  VALUES (v_post.workspace_id, p_post_id, v_scheduled_at, 'pending')
  ON CONFLICT (post_id) DO UPDATE
    SET scheduled_at = excluded.scheduled_at,
        state = 'pending',
        claim_expires_at = null,
        worker_id = null,
        attempts = 0,
        last_error = null,
        next_retry_at = null,
        updated_at = now()
    WHERE public.publish_jobs.state IN ('pending', 'failed', 'partial', 'dead')
  RETURNING * INTO v_job;

  IF v_job.id IS NULL THEN
    SELECT * INTO v_job FROM public.publish_jobs WHERE post_id = p_post_id;
  END IF;

  INSERT INTO public.platform_publish_attempts (job_id, platform, idempotency_key)
  SELECT v_job.id, platform, concat(v_job.id::text, ':', platform)
  FROM unnest(COALESCE(v_post.platforms, '{}'::text[])) AS platform
  WHERE platform IN ('instagram', 'facebook', 'linkedin', 'tiktok', 'youtube')
  ON CONFLICT (job_id, platform) DO UPDATE
    SET state = 'pending',
        external_post_id = null,
        response_payload = null,
        error_code = null,
        error_message = null,
        attempt_count = 0,
        next_retry_at = null,
        updated_at = now();

  RETURN v_job;
END $$;

REVOKE ALL ON FUNCTION public.create_publish_job_for_post(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.create_publish_job_for_post(uuid) TO service_role;
