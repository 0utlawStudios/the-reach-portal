-- ═══════════════════════════════════════════════════════════
-- BRAND PLAYBOOK TABLE
-- Paste into Supabase SQL Editor and click Run
-- ═══════════════════════════════════════════════════════════

CREATE TABLE brand_playbook (
  id         TEXT PRIMARY KEY DEFAULT 'singleton',
  data       JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT
);

-- Auto-update timestamp
CREATE TRIGGER brand_playbook_updated_at
  BEFORE UPDATE ON brand_playbook
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE brand_playbook ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for anon" ON brand_playbook
  FOR ALL USING (true) WITH CHECK (true);

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE brand_playbook;

-- ─── SEED DATA ───

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
