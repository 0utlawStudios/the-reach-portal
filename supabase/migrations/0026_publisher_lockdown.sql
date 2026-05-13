-- 0026_publisher_lockdown.sql
-- Bulletproofs the publish pipeline. Three goals:
--
--   1. Record the moment of publish: add posts.posted_at + posts.posted_urls.
--   2. Track retries cleanly: add publish_jobs.attempts + last_error + next_retry_at.
--   3. Lock down the stage='posted' transition at the database level: no human
--      drag, no anon writes — only the service-role publisher path, and only
--      when posted_at is non-null. This kills the silent-data-drift class of
--      bugs that produced the 7 ghost publish_jobs already in the queue.
--
-- Strictly additive. No drops. No NOT NULL. Safe to apply on a live database.
-- Reuses migration 0025's pattern of harden-trigger + backfill + view.

-- ─── 1. Posts: record-of-publish columns ────────────────────────────────

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS posted_at   timestamptz,
  ADD COLUMN IF NOT EXISTS posted_urls jsonb;

COMMENT ON COLUMN public.posts.posted_at IS
  'When the n8n publisher confirmed the post went live (any platform succeeded). NULL means not yet published. Required by the lockdown trigger when stage=posted.';
COMMENT ON COLUMN public.posts.posted_urls IS
  'Per-platform live URLs in shape {"facebook":"https://...","instagram":"https://...","linkedin":"https://..."}. Populated by the publisher.';

CREATE INDEX IF NOT EXISTS idx_posts_posted_at ON public.posts(posted_at DESC) WHERE posted_at IS NOT NULL;

-- ─── 2. publish_jobs: retry tracking columns ────────────────────────────

ALTER TABLE public.publish_jobs
  ADD COLUMN IF NOT EXISTS attempts      smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error    text,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz;

COMMENT ON COLUMN public.publish_jobs.attempts IS
  'Number of completed attempts. Dead-letters at 3.';
COMMENT ON COLUMN public.publish_jobs.last_error IS
  'Concatenated platform errors from the latest attempt. NULL on a clean run.';
COMMENT ON COLUMN public.publish_jobs.next_retry_at IS
  'Earliest time the next attempt may claim. Set after a transient failure. NULL = available immediately.';

-- ─── 3. claim_publish_job — honour next_retry_at and the stage gate ─────
--
-- Rewrite of the V1 RPC. Now refuses to claim:
--   • jobs whose post is no longer in stage='approved_scheduled' (orphan)
--   • jobs whose next_retry_at hasn't elapsed yet
--   • jobs that have already failed 3 attempts (caller should DLQ them)
--
-- Behaviour preserved: FOR UPDATE SKIP LOCKED, single-row return, atomic
-- state→claimed transition, claim_expires_at set for the worker.

CREATE OR REPLACE FUNCTION public.claim_publish_job(
  p_worker_id     text,
  p_claim_seconds integer DEFAULT 120
)
RETURNS SETOF public.publish_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
BEGIN
  RETURN QUERY
  UPDATE public.publish_jobs j
  SET
    state            = 'claimed',
    worker_id        = p_worker_id,
    claim_expires_at = now() + (p_claim_seconds || ' seconds')::interval,
    updated_at       = now()
  WHERE j.id = (
    SELECT j2.id
    FROM public.publish_jobs j2
    JOIN public.posts p ON p.id = j2.post_id
    WHERE j2.state = 'pending'
      AND p.stage = 'approved_scheduled'
      AND j2.scheduled_at <= now()
      AND (j2.next_retry_at IS NULL OR j2.next_retry_at <= now())
      AND j2.attempts < 3
    ORDER BY j2.scheduled_at ASC
    FOR UPDATE OF j2 SKIP LOCKED
    LIMIT 1
  )
  RETURNING j.*;
END;
$func$;

GRANT EXECUTE ON FUNCTION public.claim_publish_job(text, integer) TO service_role;

-- ─── 4. Lockdown trigger — reject manual posted writes ──────────────────
--
-- Fires BEFORE UPDATE on posts. When the stage transition is INTO 'posted',
-- it requires two things:
--   a) The session role must be one of {postgres, service_role, supabase_admin}.
--      authenticated + anon are blocked. This makes manual drag impossible.
--   b) NEW.posted_at must be non-null. This catches the "publisher wrote
--      stage='posted' but forgot the timestamp" bug class.
--
-- INSERT path is unchanged — a post being created directly in posted (e.g.
-- a back-fill) is allowed; the trigger only guards transitions.

CREATE OR REPLACE FUNCTION public.block_manual_posted_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $func$
BEGIN
  IF NEW.stage = 'posted' AND OLD.stage IS DISTINCT FROM NEW.stage THEN
    IF current_user NOT IN ('postgres', 'service_role', 'supabase_admin') THEN
      RAISE EXCEPTION
        'POSTED_LOCKDOWN: Posts can only be moved to "posted" by the n8n auto-publisher after a successful platform API call. Current user: %.',
        current_user
        USING ERRCODE = 'P0001',
              HINT    = 'Approve the post and let n8n publish it. The card will move to Posted automatically once the post goes live.';
    END IF;

    IF NEW.posted_at IS NULL THEN
      RAISE EXCEPTION
        'POSTED_LOCKDOWN: stage="posted" requires posted_at to be non-null. The publisher must record when the post went live.'
        USING ERRCODE = 'P0001',
              HINT    = 'Set posted_at = now() in the same UPDATE that flips stage to posted.';
    END IF;
  END IF;
  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS posts_block_manual_posted ON public.posts;
CREATE TRIGGER posts_block_manual_posted
  BEFORE UPDATE ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.block_manual_posted_transition();

-- ─── 5. Orphan job cleanup (one-shot, idempotent) ───────────────────────
--
-- Any pending publish_jobs whose post is already in 'posted' stage are
-- ghosts from the pre-lockdown era. Cancel them so the publisher doesn't
-- double-post on first activation. Also catch jobs whose post is in
-- earlier stages (ideas / awaiting_approval / revision_needed) — those
-- should never have had a queued job.

-- Uses state='dead' (the existing publish_jobs_state_check allows
-- pending|claimed|running|partial|succeeded|failed|dead). 'dead' means
-- permanently dead-lettered, won't retry, won't claim. The orphan jobs
-- are categorically permanent failures from a UX standpoint — the post
-- already left approved_scheduled.

UPDATE public.publish_jobs j
SET state      = 'dead',
    last_error = 'Dead-lettered by 0026 cleanup: post already in stage=posted before lockdown',
    updated_at = now()
FROM public.posts p
WHERE p.id = j.post_id
  AND j.state = 'pending'
  AND p.stage = 'posted';

UPDATE public.publish_jobs j
SET state      = 'dead',
    last_error = 'Dead-lettered by 0026 cleanup: post stage is not approved_scheduled',
    updated_at = now()
FROM public.posts p
WHERE p.id = j.post_id
  AND j.state = 'pending'
  AND p.stage NOT IN ('approved_scheduled', 'posted');

-- ─── 6. v_publish_queue — operator monitoring view ──────────────────────
--
-- Read from the new Publishing Queue settings panel. Surfaces every job
-- worth watching: pending (waiting for scheduled_at), claimed (in-flight),
-- partial/failed (needs review). Includes overdue_by + claim_stuck flags
-- so admins can spot stalls in one glance.

CREATE OR REPLACE VIEW public.v_publish_queue AS
SELECT
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
ORDER BY j.scheduled_at ASC;

GRANT SELECT ON public.v_publish_queue TO authenticated;

COMMENT ON VIEW public.v_publish_queue IS
  'Operator monitoring view for the publish queue. Read by the admin Publishing Queue panel in Settings.';
