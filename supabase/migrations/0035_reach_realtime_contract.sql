-- 0035_reach_realtime_contract.sql
-- Repo-proof the production realtime contract for the Reach clone.
-- The live project already has these tables in supabase_realtime; this
-- migration makes the requirement durable for future pushes/clones.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'posts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.posts;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'content_plan_rows'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.content_plan_rows;
  END IF;
END $$;

ALTER TABLE public.posts REPLICA IDENTITY FULL;
ALTER TABLE public.content_plan_rows REPLICA IDENTITY FULL;
