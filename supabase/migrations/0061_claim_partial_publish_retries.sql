-- 0061_claim_partial_publish_retries.sql
-- A partial publish correctly moves the post to posted when at least one
-- platform succeeds. Admins can then force-retry the publish job, but the
-- 0026 claimer only accepted posts still in approved_scheduled, so the
-- requeued failed platforms could never be reclaimed. Allow pending jobs for
-- posted posts only when the attempt ledger proves this is a partial retry:
-- at least one platform already succeeded and at least one platform still
-- needs work.

CREATE OR REPLACE FUNCTION public.claim_publish_job(
  p_worker_id text,
  p_claim_seconds integer DEFAULT 120
)
RETURNS SETOF public.publish_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.publish_jobs j
  SET
    state = 'claimed',
    worker_id = p_worker_id,
    claim_expires_at = now() + (p_claim_seconds || ' seconds')::interval,
    updated_at = now()
  WHERE j.id = (
    SELECT j2.id
    FROM public.publish_jobs j2
    JOIN public.posts p ON p.id = j2.post_id
      AND p.workspace_id = j2.workspace_id
    WHERE j2.state = 'pending'
      AND j2.scheduled_at <= now()
      AND (j2.next_retry_at IS NULL OR j2.next_retry_at <= now())
      AND j2.attempts < 3
      AND (
        p.stage = 'approved_scheduled'
        OR (
          p.stage = 'posted'
          AND p.posted_at IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.platform_publish_attempts a
            WHERE a.job_id = j2.id
              AND a.state = 'succeeded'
          )
          AND EXISTS (
            SELECT 1
            FROM public.platform_publish_attempts a
            WHERE a.job_id = j2.id
              AND a.state <> 'succeeded'
          )
        )
      )
    ORDER BY j2.scheduled_at ASC
    FOR UPDATE OF j2 SKIP LOCKED
    LIMIT 1
  )
  RETURNING j.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_publish_job(text, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.claim_publish_job(text, integer) TO service_role;
