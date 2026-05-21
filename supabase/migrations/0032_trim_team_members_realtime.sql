-- 0032_trim_team_members_realtime.sql
-- Remove team_members from Supabase Realtime if it was enabled manually or by
-- an older environment. The app now refreshes team membership on local
-- mutations, focus, visibility recovery, and a slow visible-tab interval.
-- That keeps team changes fresh without a permanent postgres_changes polling
-- stream in every authenticated browser tab.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'team_members'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.team_members;
  END IF;
END $$;
