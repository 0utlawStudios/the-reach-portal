-- ═══════════════════════════════════════════════════════════
-- AUDIT LEDGER + SOURCE VAULT
-- Paste into Supabase SQL Editor and click Run
-- ═══════════════════════════════════════════════════════════

-- ─── 1. IMMUTABLE AUDIT LOG TABLE ───

CREATE TABLE post_audit_logs (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id    UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_name  TEXT NOT NULL,
  action_type TEXT NOT NULL,
  details    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_post ON post_audit_logs(post_id);
CREATE INDEX idx_audit_created ON post_audit_logs(created_at DESC);

ALTER TABLE post_audit_logs ENABLE ROW LEVEL SECURITY;

-- STRICTLY APPEND-ONLY: Allow INSERT and SELECT only. No UPDATE. No DELETE.
CREATE POLICY "Allow insert audit" ON post_audit_logs
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow read audit" ON post_audit_logs
  FOR SELECT USING (true);

-- ─── 2. SOURCE VAULT COLUMN ON POSTS ───

ALTER TABLE posts ADD COLUMN IF NOT EXISTS source_vault JSONB DEFAULT '{}';

-- ═══════════════════════════════════════════════════════════
-- DONE — Audit ledger is immutable (no update/delete policies).
-- ═══════════════════════════════════════════════════════════
