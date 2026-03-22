-- ═══════════════════════════════════════════════════════════
-- TEN80TEN — Social Media Management Platform
-- Supabase Database Schema
-- Copy/paste this entire block into your Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════

-- ─── ENUMS ───

CREATE TYPE pipeline_stage AS ENUM (
  'ideas',
  'awaiting_approval',
  'revision_needed',
  'approved_scheduled',
  'posted'
);

CREATE TYPE content_type AS ENUM (
  'video',
  'image',
  'carousel',
  'reel',
  'story'
);

CREATE TYPE user_role AS ENUM (
  'owner',
  'admin',
  'developer',
  'editor',
  'viewer',
  'specialist',
  'technician'
);

CREATE TYPE invite_status AS ENUM (
  'active',
  'pending'
);

-- ─── POSTS TABLE (Kanban Cards) ───

CREATE TABLE posts (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title         TEXT NOT NULL,
  stage         pipeline_stage NOT NULL DEFAULT 'ideas',
  platforms     TEXT[] NOT NULL DEFAULT '{}',
  content_type  content_type NOT NULL DEFAULT 'video',
  thumbnail_url TEXT,
  scheduled_date DATE,
  scheduled_time TIME,
  caption       TEXT,
  hook          TEXT,
  notes         TEXT,
  checklist     JSONB NOT NULL DEFAULT '[]',
  media_ids     TEXT[] DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-update updated_at on row change
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER posts_updated_at
  BEFORE UPDATE ON posts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Index for fast Kanban queries (filter by stage)
CREATE INDEX idx_posts_stage ON posts(stage);

-- Index for calendar queries (filter by scheduled date)
CREATE INDEX idx_posts_scheduled ON posts(scheduled_date);

-- ─── TEAM MEMBERS TABLE ───

CREATE TABLE team_members (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name           TEXT NOT NULL,
  email          TEXT NOT NULL UNIQUE,
  role           user_role NOT NULL DEFAULT 'viewer',
  secondary_role TEXT,
  status         invite_status NOT NULL DEFAULT 'active',
  avatar_url     TEXT,
  joined_at      DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER team_members_updated_at
  BEFORE UPDATE ON team_members
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_team_email ON team_members(email);

-- ─── MEDIA ASSETS TABLE ───

CREATE TABLE media_assets (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name          TEXT NOT NULL,
  url           TEXT NOT NULL,
  file_type     TEXT NOT NULL CHECK (file_type IN ('image', 'video')),
  folder        TEXT NOT NULL DEFAULT 'Uploads',
  added_by      TEXT,
  used_in       TEXT[] DEFAULT '{}',
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_media_folder ON media_assets(folder);

-- ─── COMMENTS / NOTES TABLE (for threaded discussions) ───

CREATE TABLE post_comments (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id    UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author     TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_comments_post ON post_comments(post_id);

-- ─── ROW LEVEL SECURITY (RLS) ───
-- Enable RLS on all tables (required for Supabase)

ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_comments ENABLE ROW LEVEL SECURITY;

-- Allow all operations for authenticated users (anon key for now)
-- Tighten these policies when you add real auth in Phase 2

CREATE POLICY "Allow all for anon" ON posts
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for anon" ON team_members
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for anon" ON media_assets
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for anon" ON post_comments
  FOR ALL USING (true) WITH CHECK (true);

-- ─── SEED DATA: TEAM MEMBERS ───

INSERT INTO team_members (name, email, role, secondary_role, status, joined_at) VALUES
  ('Aldridge Dagos', 'aldridge@ten80ten.com',    'owner',      'Approver / Developer',          'active', '2025-01-01'),
  ('Christer Umali', 'christer@ten80ten.com',    'admin',      'Approver',                      'active', '2025-02-01'),
  ('Alex Nicholson', 'alex@ten80ten.com',        'admin',      'Approver',                      'active', '2025-03-01'),
  ('Carlo Navarro',  'carlo@ten80ten.com',       'specialist', 'Creative Director / Approver',  'active', '2025-04-01'),
  ('Muaaz Saifi',    'muaaz.ten80ten@gmail.com', 'specialist', 'Social Media Specialist',       'active', '2025-05-01');

-- ─── DONE ───
-- Your database is ready. The frontend will now read/write directly to these tables.
