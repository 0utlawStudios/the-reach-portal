-- ═══════════════════════════════════════════════════════════
-- AVATAR STORAGE BUCKET
-- Paste into Supabase SQL Editor and click Run
-- ═══════════════════════════════════════════════════════════

-- Create a public storage bucket for avatars
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public read access
CREATE POLICY "Public read avatars" ON storage.objects
  FOR SELECT USING (bucket_id = 'avatars');

-- Allow authenticated and anon uploads
CREATE POLICY "Allow uploads avatars" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'avatars');

-- Allow updates (overwrite)
CREATE POLICY "Allow updates avatars" ON storage.objects
  FOR UPDATE USING (bucket_id = 'avatars');

-- Allow deletes
CREATE POLICY "Allow deletes avatars" ON storage.objects
  FOR DELETE USING (bucket_id = 'avatars');
