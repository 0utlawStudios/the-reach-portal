-- ═══════════════════════════════════════════════════════════
-- TEN80TEN SMM PORTAL — COMPLETE DATABASE SETUP
-- Paste this ENTIRE block into Supabase SQL Editor and click Run
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

CREATE INDEX idx_posts_stage ON posts(stage);
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

-- ─── COMMENTS TABLE ───

CREATE TABLE post_comments (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id    UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author     TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_comments_post ON post_comments(post_id);

-- ─── BRAND PLAYBOOK TABLE ───

CREATE TABLE brand_playbook (
  id         TEXT PRIMARY KEY DEFAULT 'singleton',
  data       JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT
);

CREATE TRIGGER brand_playbook_updated_at
  BEFORE UPDATE ON brand_playbook
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ─── ROW LEVEL SECURITY ───

ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE brand_playbook ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for anon" ON posts
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for anon" ON team_members
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for anon" ON media_assets
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for anon" ON post_comments
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for anon" ON brand_playbook
  FOR ALL USING (true) WITH CHECK (true);

-- ─── REALTIME ───

ALTER PUBLICATION supabase_realtime ADD TABLE brand_playbook;

-- ─── AVATAR STORAGE BUCKET ───

INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read avatars" ON storage.objects
  FOR SELECT USING (bucket_id = 'avatars');

CREATE POLICY "Allow uploads avatars" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'avatars');

CREATE POLICY "Allow updates avatars" ON storage.objects
  FOR UPDATE USING (bucket_id = 'avatars');

CREATE POLICY "Allow deletes avatars" ON storage.objects
  FOR DELETE USING (bucket_id = 'avatars');

-- ═══════════════════════════════════════════════════════════
-- SEED DATA
-- ═══════════════════════════════════════════════════════════

-- ─── TEAM MEMBERS ───

INSERT INTO team_members (name, email, role, secondary_role, status, joined_at) VALUES
  ('Aldridge Dagos', 'aldridge@ten80ten.com',    'owner',      'Approver / Developer',          'active', '2025-01-01'),
  ('Christer Umali', 'christer@ten80ten.com',    'admin',      'Approver',                      'active', '2025-02-01'),
  ('Alex Nicholson', 'alex@ten80ten.com',        'admin',      'Approver',                      'active', '2025-03-01'),
  ('Carlo Navarro',  'carlo@ten80ten.com',       'specialist', 'Creative Director / Approver',  'active', '2025-04-01'),
  ('Muaaz Saifi',    'muaaz.ten80ten@gmail.com', 'specialist', 'Social Media Specialist',       'active', '2025-05-01');

-- ─── BRAND PLAYBOOK ───

INSERT INTO brand_playbook (id, data) VALUES ('singleton', '{
  "phone": "",
  "website": "ten80ten.com",
  "tagline": "Your tagline here",
  "serviceArea": "Your service area here",
  "hashtagCore": "#Ten80Ten #YourBrand",
  "hashtagSeasonal": "#Seasonal #Trending",
  "hashtagEngagement": "#Engagement #Community",
  "hashtagCommercial": "#Business #Professional",
  "hooks": [
    "Sample hook 1 — replace with your own.",
    "Sample hook 2 — replace with your own.",
    "Sample hook 3 — replace with your own."
  ],
  "ctas": [
    "Contact us today for a free consultation!",
    "Visit ten80ten.com to learn more.",
    "DM us or call for a free estimate."
  ],
  "whenToPost": "Define your optimal posting schedule here.",
  "contentPillars": [
    {"title": "Pillar 1", "desc": "Describe your first content pillar here."},
    {"title": "Pillar 2", "desc": "Describe your second content pillar here."},
    {"title": "Pillar 3", "desc": "Describe your third content pillar here."}
  ],
  "brandVoice": "Define your brand voice and tone here. What personality does your brand convey? How do you want to be perceived by your audience?"
}');

-- ─── POSTS (24 Kanban Cards) ───

INSERT INTO posts (title, stage, platforms, content_type, thumbnail_url, scheduled_date, scheduled_time, caption, hook, notes, checklist, created_at, updated_at) VALUES

-- IDEAS (4)
('Sample Idea Post 1', 'ideas', ARRAY['tiktok','instagram'], 'reel', 'https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=400&fit=crop', NULL, NULL, 'This is a sample caption for idea post 1. Replace with your own content.', 'Sample hook for idea 1...', NULL, '[{"id":"1","label":"Thumbnail/cover image approved","checked":false},{"id":"2","label":"Caption proofread & hashtags added","checked":false},{"id":"3","label":"Hook verified (first 3 seconds)","checked":false},{"id":"4","label":"Call-to-action included","checked":false},{"id":"5","label":"Brand guidelines followed","checked":false},{"id":"6","label":"Scheduled date confirmed","checked":false}]', '2026-03-18T00:00:00Z', '2026-03-18T00:00:00Z'),
('Sample Idea Post 2', 'ideas', ARRAY['facebook','instagram','youtube'], 'video', 'https://images.unsplash.com/photo-1611162616305-c69b3fa7fbe0?w=400&fit=crop', NULL, NULL, 'This is a sample caption for idea post 2. Replace with your own content.', 'Sample hook for idea 2...', NULL, '[{"id":"1","label":"Thumbnail/cover image approved","checked":false},{"id":"2","label":"Caption proofread & hashtags added","checked":false},{"id":"3","label":"Hook verified (first 3 seconds)","checked":false},{"id":"4","label":"Call-to-action included","checked":false},{"id":"5","label":"Brand guidelines followed","checked":false},{"id":"6","label":"Scheduled date confirmed","checked":false}]', '2026-03-17T00:00:00Z', '2026-03-17T00:00:00Z'),
('Sample Idea Post 3', 'ideas', ARRAY['linkedin','facebook'], 'carousel', 'https://images.unsplash.com/photo-1611162618071-b39a2ec055fb?w=400&fit=crop', NULL, NULL, 'This is a sample caption for idea post 3. Replace with your own content.', 'Sample hook for idea 3...', NULL, '[{"id":"1","label":"Thumbnail/cover image approved","checked":false},{"id":"2","label":"Caption proofread & hashtags added","checked":false},{"id":"3","label":"Hook verified (first 3 seconds)","checked":false},{"id":"4","label":"Call-to-action included","checked":false},{"id":"5","label":"Brand guidelines followed","checked":false},{"id":"6","label":"Scheduled date confirmed","checked":false}]', '2026-03-16T00:00:00Z', '2026-03-16T00:00:00Z'),
('Sample Idea Post 4', 'ideas', ARRAY['instagram','tiktok','linkedin'], 'reel', 'https://images.unsplash.com/photo-1611162616475-46b635cb6868?w=400&fit=crop', NULL, NULL, 'This is a sample caption for idea post 4. Replace with your own content.', 'Sample hook for idea 4...', NULL, '[{"id":"1","label":"Thumbnail/cover image approved","checked":false},{"id":"2","label":"Caption proofread & hashtags added","checked":false},{"id":"3","label":"Hook verified (first 3 seconds)","checked":false},{"id":"4","label":"Call-to-action included","checked":false},{"id":"5","label":"Brand guidelines followed","checked":false},{"id":"6","label":"Scheduled date confirmed","checked":false}]', '2026-03-15T00:00:00Z', '2026-03-15T00:00:00Z'),

-- AWAITING APPROVAL (4)
('Sample Awaiting Approval Post 1', 'awaiting_approval', ARRAY['tiktok','facebook','instagram'], 'video', 'https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=400&fit=crop', '2026-03-24', '10:00', 'This is a sample caption for an awaiting approval post. Replace with your own content.', 'Sample hook...', NULL, '[{"id":"1","label":"Thumbnail/cover image approved","checked":true},{"id":"2","label":"Caption proofread & hashtags added","checked":true},{"id":"3","label":"Hook verified (first 3 seconds)","checked":true},{"id":"4","label":"Call-to-action included","checked":true},{"id":"5","label":"Brand guidelines followed","checked":false},{"id":"6","label":"Scheduled date confirmed","checked":false}]', '2026-03-12T00:00:00Z', '2026-03-20T00:00:00Z'),
('Sample Awaiting Approval Post 2', 'awaiting_approval', ARRAY['facebook','youtube'], 'video', 'https://images.unsplash.com/photo-1611162616305-c69b3fa7fbe0?w=400&fit=crop', '2026-03-25', '14:00', 'This is a sample caption for an awaiting approval post. Replace with your own content.', 'Sample hook...', NULL, '[{"id":"1","label":"Thumbnail/cover image approved","checked":true},{"id":"2","label":"Caption proofread & hashtags added","checked":true},{"id":"3","label":"Hook verified (first 3 seconds)","checked":true},{"id":"4","label":"Call-to-action included","checked":false},{"id":"5","label":"Brand guidelines followed","checked":false},{"id":"6","label":"Scheduled date confirmed","checked":false}]', '2026-03-10T00:00:00Z', '2026-03-19T00:00:00Z'),
('Sample Awaiting Approval Post 3', 'awaiting_approval', ARRAY['instagram','linkedin','facebook'], 'carousel', 'https://images.unsplash.com/photo-1611162618071-b39a2ec055fb?w=400&fit=crop', '2026-03-26', '09:00', 'This is a sample caption for an awaiting approval post. Replace with your own content.', 'Sample hook...', NULL, '[{"id":"1","label":"Thumbnail/cover image approved","checked":true},{"id":"2","label":"Caption proofread & hashtags added","checked":true},{"id":"3","label":"Hook verified (first 3 seconds)","checked":true},{"id":"4","label":"Call-to-action included","checked":true},{"id":"5","label":"Brand guidelines followed","checked":false},{"id":"6","label":"Scheduled date confirmed","checked":false}]', '2026-03-09T00:00:00Z', '2026-03-18T00:00:00Z'),
('Sample Awaiting Approval Post 4', 'awaiting_approval', ARRAY['tiktok','instagram','youtube'], 'reel', 'https://images.unsplash.com/photo-1611162616475-46b635cb6868?w=400&fit=crop', '2026-03-27', '12:00', 'This is a sample caption for an awaiting approval post. Replace with your own content.', 'Sample hook...', NULL, '[{"id":"1","label":"Thumbnail/cover image approved","checked":true},{"id":"2","label":"Caption proofread & hashtags added","checked":true},{"id":"3","label":"Hook verified (first 3 seconds)","checked":true},{"id":"4","label":"Call-to-action included","checked":true},{"id":"5","label":"Brand guidelines followed","checked":true},{"id":"6","label":"Scheduled date confirmed","checked":false}]', '2026-03-08T00:00:00Z', '2026-03-17T00:00:00Z'),

-- REVISION NEEDED (4)
('Sample Revision Post 1', 'revision_needed', ARRAY['facebook','instagram','linkedin'], 'image', 'https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=400&fit=crop', '2026-03-23', '11:00', 'This is a sample caption for a revision post. Replace with your own content.', 'Sample hook...', 'Reviewer: Please update the image and revise the CTA.', '[{"id":"1","label":"Thumbnail/cover image approved","checked":true},{"id":"2","label":"Caption proofread & hashtags added","checked":true},{"id":"3","label":"Hook verified (first 3 seconds)","checked":false},{"id":"4","label":"Call-to-action included","checked":false},{"id":"5","label":"Brand guidelines followed","checked":false},{"id":"6","label":"Scheduled date confirmed","checked":false}]', '2026-03-06T00:00:00Z', '2026-03-20T00:00:00Z'),
('Sample Revision Post 2', 'revision_needed', ARRAY['tiktok','youtube'], 'video', 'https://images.unsplash.com/photo-1611162616305-c69b3fa7fbe0?w=400&fit=crop', '2026-03-24', '15:00', 'This is a sample caption for a revision post. Replace with your own content.', 'Sample hook...', 'Reviewer: Audio track needs replacement with royalty-free music.', '[{"id":"1","label":"Thumbnail/cover image approved","checked":true},{"id":"2","label":"Caption proofread & hashtags added","checked":true},{"id":"3","label":"Hook verified (first 3 seconds)","checked":true},{"id":"4","label":"Call-to-action included","checked":false},{"id":"5","label":"Brand guidelines followed","checked":false},{"id":"6","label":"Scheduled date confirmed","checked":false}]', '2026-03-05T00:00:00Z', '2026-03-19T00:00:00Z'),
('Sample Revision Post 3', 'revision_needed', ARRAY['instagram','linkedin'], 'carousel', 'https://images.unsplash.com/photo-1611162618071-b39a2ec055fb?w=400&fit=crop', '2026-03-25', '08:00', 'This is a sample caption for a revision post. Replace with your own content.', 'Sample hook...', 'Reviewer: Fix typo on slide 3.', '[{"id":"1","label":"Thumbnail/cover image approved","checked":true},{"id":"2","label":"Caption proofread & hashtags added","checked":true},{"id":"3","label":"Hook verified (first 3 seconds)","checked":true},{"id":"4","label":"Call-to-action included","checked":true},{"id":"5","label":"Brand guidelines followed","checked":false},{"id":"6","label":"Scheduled date confirmed","checked":false}]', '2026-03-04T00:00:00Z', '2026-03-18T00:00:00Z'),
('Sample Revision Post 4', 'revision_needed', ARRAY['linkedin'], 'carousel', 'https://images.unsplash.com/photo-1611162616475-46b635cb6868?w=400&fit=crop', '2026-03-28', '10:00', 'This is a sample caption for a revision post. Replace with your own content.', 'Sample hook...', 'Reviewer: Verify the numbers and change format to document carousel.', '[{"id":"1","label":"Thumbnail/cover image approved","checked":true},{"id":"2","label":"Caption proofread & hashtags added","checked":true},{"id":"3","label":"Hook verified (first 3 seconds)","checked":false},{"id":"4","label":"Call-to-action included","checked":false},{"id":"5","label":"Brand guidelines followed","checked":false},{"id":"6","label":"Scheduled date confirmed","checked":false}]', '2026-03-02T00:00:00Z', '2026-03-17T00:00:00Z'),

-- APPROVED / SCHEDULED (4)
('Sample Scheduled Post 1', 'approved_scheduled', ARRAY['facebook','instagram','tiktok','linkedin'], 'image', 'https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=400&fit=crop', '2026-03-22', '09:00', 'This is a sample caption for a scheduled post. Replace with your own content.', 'Sample hook...', NULL, '[{"id":"1","label":"Thumbnail/cover image approved","checked":true},{"id":"2","label":"Caption proofread & hashtags added","checked":true},{"id":"3","label":"Hook verified (first 3 seconds)","checked":true},{"id":"4","label":"Call-to-action included","checked":true},{"id":"5","label":"Brand guidelines followed","checked":true},{"id":"6","label":"Scheduled date confirmed","checked":true}]', '2026-03-01T00:00:00Z', '2026-03-21T00:00:00Z'),
('Sample Scheduled Post 2', 'approved_scheduled', ARRAY['instagram','facebook','tiktok'], 'reel', 'https://images.unsplash.com/photo-1611162616305-c69b3fa7fbe0?w=400&fit=crop', '2026-03-23', '11:00', 'This is a sample caption for a scheduled post. Replace with your own content.', 'Sample hook...', NULL, '[{"id":"1","label":"Thumbnail/cover image approved","checked":true},{"id":"2","label":"Caption proofread & hashtags added","checked":true},{"id":"3","label":"Hook verified (first 3 seconds)","checked":true},{"id":"4","label":"Call-to-action included","checked":true},{"id":"5","label":"Brand guidelines followed","checked":true},{"id":"6","label":"Scheduled date confirmed","checked":true}]', '2026-03-02T00:00:00Z', '2026-03-20T00:00:00Z'),
('Sample Scheduled Post 3', 'approved_scheduled', ARRAY['linkedin','instagram'], 'video', 'https://images.unsplash.com/photo-1611162618071-b39a2ec055fb?w=400&fit=crop', '2026-03-26', '08:00', 'This is a sample caption for a scheduled post. Replace with your own content.', 'Sample hook...', NULL, '[{"id":"1","label":"Thumbnail/cover image approved","checked":true},{"id":"2","label":"Caption proofread & hashtags added","checked":true},{"id":"3","label":"Hook verified (first 3 seconds)","checked":true},{"id":"4","label":"Call-to-action included","checked":true},{"id":"5","label":"Brand guidelines followed","checked":true},{"id":"6","label":"Scheduled date confirmed","checked":true}]', '2026-03-05T00:00:00Z', '2026-03-21T00:00:00Z'),
('Sample Scheduled Post 4', 'approved_scheduled', ARRAY['youtube','facebook'], 'video', 'https://images.unsplash.com/photo-1611162616475-46b635cb6868?w=400&fit=crop', '2026-03-29', '14:00', 'This is a sample caption for a scheduled post. Replace with your own content.', 'Sample hook...', NULL, '[{"id":"1","label":"Thumbnail/cover image approved","checked":true},{"id":"2","label":"Caption proofread & hashtags added","checked":true},{"id":"3","label":"Hook verified (first 3 seconds)","checked":true},{"id":"4","label":"Call-to-action included","checked":true},{"id":"5","label":"Brand guidelines followed","checked":true},{"id":"6","label":"Scheduled date confirmed","checked":true}]', '2026-03-08T00:00:00Z', '2026-03-21T00:00:00Z'),

-- POSTED — RECENT (2)
('Sample Posted Content 1', 'posted', ARRAY['instagram','facebook'], 'reel', 'https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=400&fit=crop', '2026-03-15', '10:00', 'This is a sample caption for a posted piece of content. Replace with your own.', 'Sample hook...', NULL, '[{"id":"1","label":"Thumbnail/cover image approved","checked":true},{"id":"2","label":"Caption proofread & hashtags added","checked":true},{"id":"3","label":"Hook verified (first 3 seconds)","checked":true},{"id":"4","label":"Call-to-action included","checked":true},{"id":"5","label":"Brand guidelines followed","checked":true},{"id":"6","label":"Scheduled date confirmed","checked":true}]', '2026-03-01T00:00:00Z', '2026-03-15T00:00:00Z'),
('Sample Posted Content 2', 'posted', ARRAY['facebook','linkedin','youtube'], 'video', 'https://images.unsplash.com/photo-1611162616305-c69b3fa7fbe0?w=400&fit=crop', '2026-03-12', '09:00', 'This is a sample caption for a posted piece of content. Replace with your own.', 'Sample hook...', NULL, '[{"id":"1","label":"Thumbnail/cover image approved","checked":true},{"id":"2","label":"Caption proofread & hashtags added","checked":true},{"id":"3","label":"Hook verified (first 3 seconds)","checked":true},{"id":"4","label":"Call-to-action included","checked":true},{"id":"5","label":"Brand guidelines followed","checked":true},{"id":"6","label":"Scheduled date confirmed","checked":true}]', '2026-02-28T00:00:00Z', '2026-03-12T00:00:00Z'),

-- POSTED — ARCHIVE (6)
('Sample Archive Post 1', 'posted', ARRAY['facebook','instagram'], 'video', 'https://images.unsplash.com/photo-1611162618071-b39a2ec055fb?w=400&fit=crop', '2026-01-10', '10:00', 'Archived sample content. Replace with your own.', 'Sample hook...', NULL, '[{"id":"1","label":"Thumbnail/cover image approved","checked":true},{"id":"2","label":"Caption proofread & hashtags added","checked":true},{"id":"3","label":"Hook verified (first 3 seconds)","checked":true},{"id":"4","label":"Call-to-action included","checked":true},{"id":"5","label":"Brand guidelines followed","checked":true},{"id":"6","label":"Scheduled date confirmed","checked":true}]', '2026-01-05T00:00:00Z', '2026-01-10T00:00:00Z'),
('Sample Archive Post 2', 'posted', ARRAY['instagram','tiktok','youtube'], 'reel', 'https://images.unsplash.com/photo-1611162616475-46b635cb6868?w=400&fit=crop', '2025-12-20', '12:00', 'Archived sample content. Replace with your own.', 'Sample hook...', NULL, '[{"id":"1","label":"Thumbnail/cover image approved","checked":true},{"id":"2","label":"Caption proofread & hashtags added","checked":true},{"id":"3","label":"Hook verified (first 3 seconds)","checked":true},{"id":"4","label":"Call-to-action included","checked":true},{"id":"5","label":"Brand guidelines followed","checked":true},{"id":"6","label":"Scheduled date confirmed","checked":true}]', '2025-12-15T00:00:00Z', '2025-12-20T00:00:00Z'),
('Sample Archive Post 3', 'posted', ARRAY['facebook','instagram','tiktok'], 'image', 'https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=400&fit=crop', '2025-11-28', '06:00', 'Archived sample content. Replace with your own.', 'Sample hook...', NULL, '[{"id":"1","label":"Thumbnail/cover image approved","checked":true},{"id":"2","label":"Caption proofread & hashtags added","checked":true},{"id":"3","label":"Hook verified (first 3 seconds)","checked":true},{"id":"4","label":"Call-to-action included","checked":true},{"id":"5","label":"Brand guidelines followed","checked":true},{"id":"6","label":"Scheduled date confirmed","checked":true}]', '2025-11-20T00:00:00Z', '2025-11-28T00:00:00Z'),
('Sample Archive Post 4', 'posted', ARRAY['youtube','facebook'], 'video', 'https://images.unsplash.com/photo-1611162616305-c69b3fa7fbe0?w=400&fit=crop', '2025-10-15', '10:00', 'Archived sample content. Replace with your own.', 'Sample hook...', NULL, '[{"id":"1","label":"Thumbnail/cover image approved","checked":true},{"id":"2","label":"Caption proofread & hashtags added","checked":true},{"id":"3","label":"Hook verified (first 3 seconds)","checked":true},{"id":"4","label":"Call-to-action included","checked":true},{"id":"5","label":"Brand guidelines followed","checked":true},{"id":"6","label":"Scheduled date confirmed","checked":true}]', '2025-10-10T00:00:00Z', '2025-10-15T00:00:00Z'),
('Sample Archive Post 5', 'posted', ARRAY['linkedin','facebook','instagram'], 'carousel', 'https://images.unsplash.com/photo-1611162618071-b39a2ec055fb?w=400&fit=crop', '2025-09-01', '09:00', 'Archived sample content. Replace with your own.', 'Sample hook...', NULL, '[{"id":"1","label":"Thumbnail/cover image approved","checked":true},{"id":"2","label":"Caption proofread & hashtags added","checked":true},{"id":"3","label":"Hook verified (first 3 seconds)","checked":true},{"id":"4","label":"Call-to-action included","checked":true},{"id":"5","label":"Brand guidelines followed","checked":true},{"id":"6","label":"Scheduled date confirmed","checked":true}]', '2025-08-25T00:00:00Z', '2025-09-01T00:00:00Z'),
('Sample Archive Post 6', 'posted', ARRAY['instagram','facebook','linkedin','tiktok'], 'reel', 'https://images.unsplash.com/photo-1611162616475-46b635cb6868?w=400&fit=crop', '2025-08-15', '12:00', 'Archived sample content. Replace with your own.', 'Sample hook...', NULL, '[{"id":"1","label":"Thumbnail/cover image approved","checked":true},{"id":"2","label":"Caption proofread & hashtags added","checked":true},{"id":"3","label":"Hook verified (first 3 seconds)","checked":true},{"id":"4","label":"Call-to-action included","checked":true},{"id":"5","label":"Brand guidelines followed","checked":true},{"id":"6","label":"Scheduled date confirmed","checked":true}]', '2025-08-10T00:00:00Z', '2025-08-15T00:00:00Z');

-- ─── MEDIA ASSETS ───

INSERT INTO media_assets (name, url, file_type, folder, added_by, used_in) VALUES
  ('sample-image-1.jpg',  'https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=400&fit=crop', 'image', 'General',    'Aldridge', ARRAY[]::TEXT[]),
  ('sample-video-1.mp4',  'https://images.unsplash.com/photo-1611162616305-c69b3fa7fbe0?w=400&fit=crop', 'video', 'General',    'Christer', ARRAY[]::TEXT[]),
  ('sample-image-2.jpg',  'https://images.unsplash.com/photo-1611162618071-b39a2ec055fb?w=400&fit=crop', 'image', 'Marketing',  'Alex',     ARRAY[]::TEXT[]),
  ('sample-video-2.mp4',  'https://images.unsplash.com/photo-1611162616475-46b635cb6868?w=400&fit=crop', 'video', 'Marketing',  'Carlo',    ARRAY[]::TEXT[]),
  ('sample-image-3.jpg',  'https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=400&fit=crop', 'image', 'Team',       'Muaaz',    ARRAY[]::TEXT[]);

-- ═══════════════════════════════════════════════════════════
-- SETUP COMPLETE
-- 5 tables, 5 team members, 24 posts, 5 media assets, 1 brand playbook
-- ═══════════════════════════════════════════════════════════
