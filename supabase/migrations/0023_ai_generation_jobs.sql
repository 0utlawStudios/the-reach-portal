-- 0023_ai_generation_jobs.sql
-- Durable queue table for AI generation + revision work. The webhook + cron
-- pattern enqueues jobs here; the worker claims them, runs the pipeline,
-- and writes the result back to posts + the originating content_plan_rows row.
--
-- Writes are service-role only. Reads are gated to active workspace members
-- so the Studio UI can poll for status. claim_token + claimed_at provide an
-- at-most-once-in-flight guarantee for concurrent cron firings.

CREATE TABLE IF NOT EXISTS ai_generation_jobs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL,
  kind              text NOT NULL,
  status            text NOT NULL DEFAULT 'queued',
  plan_row_id       uuid REFERENCES content_plan_rows(id) ON DELETE SET NULL,
  post_id           uuid REFERENCES posts(id) ON DELETE SET NULL,
  requested_by      text,
  payload           jsonb NOT NULL DEFAULT '{}'::jsonb,
  result            jsonb,
  error             text,
  claim_token       uuid,
  claimed_at        timestamptz,
  started_at        timestamptz,
  completed_at      timestamptz,
  tokens_in         integer,
  tokens_out        integer,
  images_generated  integer,
  cost_usd          numeric(10,4),
  attempt           smallint NOT NULL DEFAULT 0,
  max_attempts      smallint NOT NULL DEFAULT 2,
  created_at        timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_jobs_kind_values') THEN
    ALTER TABLE ai_generation_jobs
      ADD CONSTRAINT ai_jobs_kind_values CHECK (kind IN ('generate','revise'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_jobs_status_values') THEN
    ALTER TABLE ai_generation_jobs
      ADD CONSTRAINT ai_jobs_status_values
      CHECK (status IN ('queued','running','completed','failed','cancelled'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ai_jobs_status_created
  ON ai_generation_jobs(status, created_at)
  WHERE status IN ('queued','running');
CREATE INDEX IF NOT EXISTS idx_ai_jobs_plan_row
  ON ai_generation_jobs(plan_row_id)
  WHERE plan_row_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_jobs_workspace_created
  ON ai_generation_jobs(workspace_id, created_at DESC);

ALTER TABLE ai_generation_jobs ENABLE ROW LEVEL SECURITY;

-- Members can read job rows in their workspace so the Studio UI can poll.
DROP POLICY IF EXISTS "ai_jobs_select_members" ON ai_generation_jobs;
CREATE POLICY "ai_jobs_select_members" ON ai_generation_jobs
  FOR SELECT USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
       WHERE user_id = auth.uid() AND status = 'active'
    )
  );

-- No INSERT/UPDATE/DELETE policies are created — writes are service-role only.
-- The API routes enforce role + rate-limits before calling the admin client.
