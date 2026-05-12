-- 0020_ai_content_fields.sql
-- Additive: AI content-generation metadata + strategy fields on posts, plus
-- "do/avoid" content rules added to brand_playbook.data.
--
-- All new posts columns are nullable (except revision_count which has a
-- default of 0) so the older client keeps inserting without them. Pairs
-- with the /api/ai/* MVP shipped in commits 2-5 (2026-05-13).

-- ─── 1. New columns on posts ───

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS content_pillar       text,
  ADD COLUMN IF NOT EXISTS target_audience      text,
  ADD COLUMN IF NOT EXISTS business_objective   text,
  ADD COLUMN IF NOT EXISTS visual_brief         text,
  ADD COLUMN IF NOT EXISTS post_format          text,
  ADD COLUMN IF NOT EXISTS carousel_outline     jsonb,
  ADD COLUMN IF NOT EXISTS hashtags             text[],
  ADD COLUMN IF NOT EXISTS cta                  text,
  ADD COLUMN IF NOT EXISTS source_notes         jsonb,
  ADD COLUMN IF NOT EXISTS quality_score        smallint,
  ADD COLUMN IF NOT EXISTS approval_notes       text,
  ADD COLUMN IF NOT EXISTS generated_by_model   text,
  ADD COLUMN IF NOT EXISTS prompt_version       text,
  ADD COLUMN IF NOT EXISTS revision_count       integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS approved_by          text,
  ADD COLUMN IF NOT EXISTS approved_at          timestamptz;

-- quality_score CHECK added separately so the migration is rerunnable.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'posts_quality_score_range'
  ) THEN
    ALTER TABLE posts
      ADD CONSTRAINT posts_quality_score_range
      CHECK (quality_score IS NULL OR (quality_score BETWEEN 1 AND 10));
  END IF;
END $$;

-- Index for surfacing AI-generated posts cheaply (UI filter, audit views).
CREATE INDEX IF NOT EXISTS idx_posts_generated_by_model
  ON posts(generated_by_model)
  WHERE generated_by_model IS NOT NULL;

-- ─── 2. Brand rules: do/avoid content lists added to brand_playbook.data ───
-- These are the "BEHAVIOR" half of Ten80Ten's brand rules per the AI MVP plan.
-- Admins can edit them later via Settings → Brand Kit. Pre-seed with the
-- defaults from the AI spec so day-1 generation works.

UPDATE brand_playbook
SET data = data
  || jsonb_build_object(
    'doFocus', jsonb_build_array(
      'Business systems',
      'Workflow cleanup',
      'Automation',
      'AI tools',
      'Virtual assistants',
      'Delegation',
      'Operations support',
      'Founder and operator pain points',
      'Before-and-after process improvements',
      'Practical business education'
    ),
    'doAvoid', jsonb_build_array(
      'Generic motivational quotes',
      'Pushy sales language',
      'Fake case studies',
      'Fake testimonials',
      'Too many hashtags',
      'Buzzword-heavy captions',
      'Repetitive hooks',
      'Overpromising'
    )
  )
WHERE id = 'singleton'
  AND (
    (data->'doFocus') IS NULL
    OR (data->'doAvoid') IS NULL
  );
