-- 0019_fix_post_timezone_column_default.sql
-- 0016 fixed the data (UPDATE statements) and the publish-job RPC, but did
-- not change the column DEFAULT on posts.scheduled_timezone. New inserts that
-- omit scheduled_timezone would still get the legacy Asia/Dubai value.
--
-- Applied to production 2026-05-13.

ALTER TABLE posts
  ALTER COLUMN scheduled_timezone SET DEFAULT 'America/Chicago';
