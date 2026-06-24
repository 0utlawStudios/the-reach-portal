-- Stop writing revision/kickback attachments into the public avatars bucket.
-- Future kickback attachments use the private support-attachments bucket and
-- are served through an authenticated app route.

DROP POLICY IF EXISTS "Authenticated own avatar uploads" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated own avatar updates" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated own avatar deletes" ON storage.objects;

CREATE POLICY "Authenticated own avatar uploads" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = 'profiles'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

CREATE POLICY "Authenticated own avatar updates" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = 'profiles'
    AND (storage.foldername(name))[2] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = 'profiles'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

CREATE POLICY "Authenticated own avatar deletes" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = 'profiles'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );
