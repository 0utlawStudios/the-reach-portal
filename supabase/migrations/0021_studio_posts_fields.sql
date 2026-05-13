-- 0021_studio_posts_fields.sql
-- Strictly additive: extends `posts` with the Creator Studio fields needed
-- for the AI generation MVP. Pairs with 0020_ai_content_fields.sql which
-- already added the strategy + audit columns (content_pillar, hashtags,
-- carousel_outline, visual_brief, cta, quality_score, approval_notes,
-- generated_by_model, prompt_version, revision_count, approved_by, approved_at).
--
-- New here:
--   * feel              — editorial mood from the sheet (Educational, Story…)
--   * visual_style      — visual treatment (Photography, Illustration, Infographic…)
--   * style_prompt      — operator-supplied style steering text
--   * slides_count      — carousel slide count (1..10)
--   * media_type        — 'image' | 'video'
--   * aspect_ratio      — '1:1' | '4:5' | '9:16' | '1.91:1'
--   * asset_width       — final asset width in pixels
--   * asset_height      — final asset height in pixels
--   * asset_urls        — array of signed Supabase Storage URLs (carousel slides)
--   * asset_storage_keys— array of object keys for refreshing signed URLs
--   * plan_row_id       — link back to the content_plan_rows row that produced this post
--
-- Nullable on every column. No defaults (other than empty array assumptions).
-- Iron-law-safe: no drops, no renames, no enum changes, no NOT NULL.

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS feel               text,
  ADD COLUMN IF NOT EXISTS visual_style       text,
  ADD COLUMN IF NOT EXISTS style_prompt       text,
  ADD COLUMN IF NOT EXISTS slides_count       smallint,
  ADD COLUMN IF NOT EXISTS media_type         text,
  ADD COLUMN IF NOT EXISTS aspect_ratio       text,
  ADD COLUMN IF NOT EXISTS asset_width        smallint,
  ADD COLUMN IF NOT EXISTS asset_height       smallint,
  ADD COLUMN IF NOT EXISTS asset_urls         text[],
  ADD COLUMN IF NOT EXISTS asset_storage_keys text[],
  ADD COLUMN IF NOT EXISTS plan_row_id        uuid;

-- CHECK constraints added separately so the migration is rerunnable.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_slides_count_range') THEN
    ALTER TABLE posts
      ADD CONSTRAINT posts_slides_count_range
      CHECK (slides_count IS NULL OR (slides_count BETWEEN 1 AND 10));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_media_type_values') THEN
    ALTER TABLE posts
      ADD CONSTRAINT posts_media_type_values
      CHECK (media_type IS NULL OR media_type IN ('image','video'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_aspect_ratio_values') THEN
    ALTER TABLE posts
      ADD CONSTRAINT posts_aspect_ratio_values
      CHECK (aspect_ratio IS NULL OR aspect_ratio IN ('1:1','4:5','9:16','1.91:1'));
  END IF;
END $$;

-- Lookup index for "show me posts produced from this plan row".
CREATE INDEX IF NOT EXISTS idx_posts_plan_row_id
  ON posts(plan_row_id)
  WHERE plan_row_id IS NOT NULL;
