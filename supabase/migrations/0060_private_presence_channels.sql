-- 0060_private_presence_channels.sql
-- The presence table is tenant-scoped through v_user_presence_summary, but
-- live Supabase Realtime presence also needs authorization. Public presence
-- channels are guessable by workspace UUID, so require private-channel RLS for
-- presence-<workspace_id> topics.

ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workspace_presence_listen" ON realtime.messages;
DROP POLICY IF EXISTS "workspace_presence_track" ON realtime.messages;

CREATE POLICY "workspace_presence_listen"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  realtime.messages.extension = 'presence'
  AND EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.user_id = auth.uid()
      AND wm.status = 'active'
      AND wm.workspace_id = substring(
        realtime.topic()
        FROM '^presence-([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$'
      )::uuid
  )
);

CREATE POLICY "workspace_presence_track"
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK (
  realtime.messages.extension = 'presence'
  AND EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.user_id = auth.uid()
      AND wm.status = 'active'
      AND wm.workspace_id = substring(
        realtime.topic()
        FROM '^presence-([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$'
      )::uuid
  )
);
