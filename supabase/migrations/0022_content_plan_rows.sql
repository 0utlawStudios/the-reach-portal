-- 0022_content_plan_rows.sql
-- Persisted rows for the Creator Studio sheet UI. Each row is an operator's
-- intent for a single post (date, platform, format, vibe, topic, notes).
-- When the operator clicks Generate, an ai_generation_jobs row is enqueued
-- and on success the resulting posts.id is linked back here.
--
-- RLS follows the same workspace_members + user_id gate as every other
-- domain table (0007_rls_v2.sql convention). Reads gated on active membership,
-- writes additionally gated on writer-class roles.

CREATE TABLE IF NOT EXISTS content_plan_rows (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL,
  created_by        text NOT NULL,
  row_index         integer NOT NULL,
  scheduled_date    date,
  scheduled_time    time,
  platforms         text[],
  media_type        text,
  format            text,
  slides_count      smallint,
  resolved_aspect   text,
  feel              text,
  visual_style      text,
  style_prompt      text,
  topic             text,
  notes             text,
  status            text NOT NULL DEFAULT 'empty',
  generated_post_id uuid REFERENCES posts(id) ON DELETE SET NULL,
  last_error        text,
  cost_usd          numeric(10,4),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Constraints added separately so the migration is rerunnable.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'plan_rows_slides_count_range') THEN
    ALTER TABLE content_plan_rows
      ADD CONSTRAINT plan_rows_slides_count_range
      CHECK (slides_count IS NULL OR (slides_count BETWEEN 1 AND 10));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'plan_rows_media_type_values') THEN
    ALTER TABLE content_plan_rows
      ADD CONSTRAINT plan_rows_media_type_values
      CHECK (media_type IS NULL OR media_type IN ('image','video'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'plan_rows_resolved_aspect_values') THEN
    ALTER TABLE content_plan_rows
      ADD CONSTRAINT plan_rows_resolved_aspect_values
      CHECK (resolved_aspect IS NULL OR resolved_aspect IN ('1:1','4:5','9:16','1.91:1'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'plan_rows_status_values') THEN
    ALTER TABLE content_plan_rows
      ADD CONSTRAINT plan_rows_status_values
      CHECK (status IN ('empty','ready','generating','generated','failed','revising'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_plan_rows_workspace_date
  ON content_plan_rows(workspace_id, scheduled_date);
CREATE INDEX IF NOT EXISTS idx_plan_rows_workspace_status
  ON content_plan_rows(workspace_id, status);

ALTER TABLE content_plan_rows ENABLE ROW LEVEL SECURITY;

-- Active workspace members can read plan rows.
DROP POLICY IF EXISTS "plan_rows_select_members" ON content_plan_rows;
CREATE POLICY "plan_rows_select_members" ON content_plan_rows
  FOR SELECT USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
       WHERE user_id = auth.uid() AND status = 'active'
    )
  );

-- Writer-class members can insert/update/delete plan rows.
-- (The API layer enforces a tighter role allow-list; this is the defence-in-depth gate.)
DROP POLICY IF EXISTS "plan_rows_write_writers" ON content_plan_rows;
CREATE POLICY "plan_rows_write_writers" ON content_plan_rows
  FOR ALL USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
       WHERE user_id = auth.uid()
         AND status = 'active'
         AND role IN ('superadmin','admin','owner','approver','creative_director','editor','social_media_specialist','video_editor','graphic_designer','specialist','technician')
    )
  ) WITH CHECK (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
       WHERE user_id = auth.uid()
         AND status = 'active'
         AND role IN ('superadmin','admin','owner','approver','creative_director','editor','social_media_specialist','video_editor','graphic_designer','specialist','technician')
    )
  );

-- updated_at trigger (mirrors posts_updated_at pattern).
CREATE OR REPLACE FUNCTION update_plan_rows_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS plan_rows_updated_at ON content_plan_rows;
CREATE TRIGGER plan_rows_updated_at
  BEFORE UPDATE ON content_plan_rows
  FOR EACH ROW EXECUTE FUNCTION update_plan_rows_updated_at();
