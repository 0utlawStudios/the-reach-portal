-- Lightweight sidebar Support Inbox alert checks.
-- These partial indexes keep the superadmin dot from scanning support_threads
-- while still letting the UI ask a tiny "does anything need attention?" question.

create index if not exists support_threads_admin_unread_idx
  on support_threads (workspace_id, last_message_at desc)
  where unread_for_admin = true;

create index if not exists support_threads_admin_untouched_open_ticket_idx
  on support_threads (workspace_id, last_message_at desc)
  where kind = 'ticket' and status = 'open' and admin_last_read_at is null;
