-- Enable realtime for media_assets table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'media_assets'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE media_assets;
  END IF;
END $$;

-- Set REPLICA IDENTITY FULL so DELETE payloads include the full row (needed for payload.old.id)
ALTER TABLE media_assets REPLICA IDENTITY FULL;
