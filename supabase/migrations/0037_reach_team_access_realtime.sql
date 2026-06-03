-- 0037_reach_team_access_realtime.sql
-- The Reach production needs immediate Settings/auth invalidation for access
-- requests, invites, activations, and removals. These tables are published so
-- the client can refresh from the normal RLS-protected SELECT path whenever a
-- change occurs.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'team_members'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.team_members;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'signup_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.signup_requests;
  END IF;
END $$;

ALTER TABLE public.team_members REPLICA IDENTITY FULL;
ALTER TABLE public.signup_requests REPLICA IDENTITY FULL;
