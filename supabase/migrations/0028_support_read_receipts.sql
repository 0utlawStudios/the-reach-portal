-- 0028_support_read_receipts.sql
-- Read-receipt timestamps for support threads + a one-chat-per-user guarantee.
--
-- Depends on: 0027_support_center.sql
--
-- user_last_read_at / admin_last_read_at record when each side last opened a
-- thread. The UI derives a "Seen" marker by comparing these against message
-- timestamps. NULL means that side has never opened the thread.
--
-- The partial unique index closes a create/create race: before 0028, "one
-- live-chat thread per user" was enforced only in application code, so a user
-- sending their first message at the same moment an admin started a chat with
-- them could produce two chat threads. The DB now forbids it.

-- ─── read-receipt columns ───

alter table support_threads
  add column if not exists user_last_read_at  timestamptz,
  add column if not exists admin_last_read_at timestamptz;

-- ─── one live-chat thread per user, per workspace ───

-- Defensive: merge any pre-existing duplicate chat threads. Keep the earliest
-- thread per (workspace_id, created_by); re-point the losers' messages onto it.
with ranked as (
  select id,
         first_value(id) over (
           partition by workspace_id, created_by order by created_at, id
         ) as keeper_id,
         row_number() over (
           partition by workspace_id, created_by order by created_at, id
         ) as rn
  from support_threads
  where kind = 'chat' and created_by is not null
)
update support_messages m
   set thread_id = r.keeper_id
  from ranked r
 where r.rn > 1 and m.thread_id = r.id;

-- Drop the now-empty duplicate threads.
with ranked as (
  select id,
         row_number() over (
           partition by workspace_id, created_by order by created_at, id
         ) as rn
  from support_threads
  where kind = 'chat' and created_by is not null
)
delete from support_threads t
 using ranked r
 where r.rn > 1 and t.id = r.id;

create unique index if not exists support_threads_one_chat_per_user
  on support_threads (workspace_id, created_by)
  where kind = 'chat' and created_by is not null;
