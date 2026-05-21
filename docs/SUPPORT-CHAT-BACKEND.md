# Support Chat And Support Inbox Backend

Last updated: 2026-05-21

This document is the source of truth for the Ten80Ten in-app support widget, live chat, and admin Support Inbox backend.

## Short Answer

The chat feature and Support Inbox are backed by:

- Next.js API routes under `src/app/api/support/*`
- Supabase Postgres tables: `support_threads` and `support_messages`
- Supabase Realtime on those two tables
- Supabase Storage private bucket: `support-attachments`
- SMTP email notifications through `nodemailer`
- One-way Telegram notifications for admin alerts
- Audit logging through `record_audit_event()` into `audit_log_v2`

Telegram is not the chat backend. Email is not the chat backend. They are notification channels only. All conversation state lives in Supabase Postgres and is written through server-side Next.js API routes.

The Support Inbox UI is a superadmin-only page in the main left sidebar. It is intentionally not embedded in Settings. The sidebar alert dot is backed by a tiny attention-check endpoint, not by loading the full inbox.

## Backend Stack

| Layer | Implementation | Purpose |
| --- | --- | --- |
| API backend | Next.js route handlers in `src/app/api/support/*` | Auth, validation, writes, reads, notifications |
| Database | Supabase Postgres | Durable threads, messages, read receipts, unread flags |
| Realtime | Supabase Realtime publication | Live updates for open support widget and admin inbox |
| File storage | Supabase Storage bucket `support-attachments` | Private screenshots/videos attached to tickets or chat |
| Auth | Supabase Auth bearer token validation | Identifies the current user and workspace |
| Permissions | RLS plus server-side service-role writes | Users see their own threads; superadmin sees workspace inbox |
| Notifications | SMTP and Telegram | Alerts admin/user after durable DB writes |
| Audit | `record_audit_event()` RPC | Stores support events in `audit_log_v2` |
| Rate limiting | `consume()` helper | Limits ticket creation, messages, uploads, and start-chat calls |

## Schema

### `support_threads`

Defined in `supabase/migrations/0027_support_center.sql`.

Key columns:

- `id`: UUID primary key.
- `workspace_id`: required workspace foreign key.
- `created_by`: auth user id of the thread owner.
- `created_by_email`: owner email snapshot.
- `created_by_name`: owner display name snapshot.
- `kind`: `ticket` or `chat`.
- `subject`: ticket subject or `Live chat`.
- `category`: ticket category such as `bug`, `question`, `billing`, or `other`.
- `status`: `open`, `in_progress`, `resolved`, or `closed`.
- `last_message_at`: ordering key for inbox lists.
- `last_sender_type`: `user`, `admin`, or `system`.
- `unread_for_user`: user-side unread flag.
- `unread_for_admin`: admin-side unread flag.
- `user_last_read_at`: user read receipt timestamp.
- `admin_last_read_at`: admin read receipt timestamp.
- `last_user_notified_at`: debounce timestamp for user email alerts.
- `last_admin_notified_at`: debounce timestamp for admin Telegram alerts.

Important indexes:

- `support_threads_owner_idx` on `(created_by, last_message_at desc)`
- `support_threads_ws_idx` on `(workspace_id, status, last_message_at desc)`
- `support_threads_one_chat_per_user` unique partial index on `(workspace_id, created_by)` where `kind = 'chat'`
- `support_threads_admin_unread_idx` partial index for superadmin unread-alert checks
- `support_threads_admin_untouched_open_ticket_idx` partial index for new open-ticket alert checks

The unique partial index is critical. It guarantees one live-chat thread per user per workspace and prevents duplicate chats during create/create races.

The alert indexes live in `supabase/migrations/0031_support_alert_indexes.sql`. They keep the small sidebar dot from scanning `support_threads`.

### `support_messages`

Defined in `supabase/migrations/0027_support_center.sql`.

Key columns:

- `id`: UUID primary key.
- `thread_id`: parent support thread.
- `workspace_id`: required workspace foreign key.
- `sender_type`: `user`, `admin`, or `system`.
- `sender_name`: display name snapshot.
- `body`: message text, nullable when attachments are sent alone.
- `attachments`: JSONB array of signed attachment metadata.
- `created_at`: message timestamp.

Important index:

- `support_messages_thread_idx` on `(thread_id, created_at)`

## Access Model

The model is intentionally strict:

- Browser clients do not write directly to `support_threads` or `support_messages`.
- Authenticated users have SELECT RLS only.
- All inserts, updates, attachment checks, status changes, notifications, and audit writes happen in server routes using the Supabase service-role client.
- A user can read only their own support threads.
- A superadmin can read and manage all support threads inside their own workspace.
- Non-owners and non-superadmins receive `404 Not found` for thread detail/actions so thread existence is not leaked.

RLS policies are in `0027_support_center.sql`:

- `support_threads_select`: active workspace member AND either thread owner or workspace superadmin.
- `support_messages_select`: readable only when the parent thread is readable.

To let another role operate the Support Inbox in the future, update all three places:

- RLS role array in `0027_support_center.sql`
- API role gates using `requireBearerTeamRole(..., ["superadmin"])`
- UI visibility for the main-sidebar Support Inbox route

## API Routes

All routes validate the caller with Supabase bearer tokens. All write routes use service-role DB access after validation.

### `POST /api/support/uploads`

Purpose:

- Mint one-shot signed upload URLs for support attachments.

Flow:

1. Validate bearer token.
2. Rate limit with scope `support:upload`, 40 requests per 5 minutes.
3. Validate requested file count and metadata.
4. Resolve caller workspace.
5. Create signed upload URLs in the private `support-attachments` bucket.
6. Browser uploads files directly to Supabase Storage using `uploadToSignedUrl()`.

Limits:

- Max 5 files.
- Max 25 MB per file.
- Allowed MIME types: PNG, JPEG, WEBP, GIF, MP4, QuickTime.

### `GET /api/support/threads`

Purpose:

- List the caller's own tickets and chat threads.

Behavior:

- Validates bearer token.
- Resolves workspace.
- Returns up to 100 caller-owned threads ordered by `last_message_at desc`.

### `GET /api/support/threads?scope=all`

Purpose:

- Admin Support Inbox list.

Behavior:

- Requires `superadmin`.
- Resolves the superadmin's workspace.
- Returns up to 500 workspace threads ordered by `last_message_at desc`.

### `GET /api/support/alert`

Purpose:

- Lightweight superadmin-only sidebar dot check.

Behavior:

- Requires `superadmin`.
- Resolves the superadmin's workspace.
- Returns `{ hasAlert: true }` when there is an unread admin-side thread or an untouched open ticket.
- Uses the partial indexes in migration `0031_support_alert_indexes.sql`.
- Does not return thread content or load the full Support Inbox.

### `POST /api/support/threads`

Purpose:

- Create a support ticket.

Flow:

1. Validate bearer token.
2. Rate limit with scope `support:create`, 5 tickets per hour.
3. Validate body length and category.
4. Verify claimed attachments belong to the caller's own storage prefix.
5. Insert `support_threads` row with `kind = 'ticket'`.
6. Insert first `support_messages` row.
7. If message insert fails, delete the orphan thread.
8. Write `ticket_created` audit event.
9. Notify admin by SMTP email and Telegram.

### `GET /api/support/threads/[id]`

Purpose:

- Load one thread plus all messages.

Behavior:

- Thread owner can load their own thread.
- Superadmin can load any thread in their workspace.
- Everyone else gets `404`.
- Attachments are re-signed on every read so stored URLs can expire safely.

### `PATCH /api/support/threads/[id]`

Purpose:

- Update thread status.

Behavior:

- Requires `superadmin`.
- Only updates a thread inside the caller's workspace.
- Allowed statuses: `open`, `in_progress`, `resolved`, `closed`.
- Writes `support_status_changed` audit event.

### `POST /api/support/threads/[id]/messages`

Purpose:

- Append a message to a ticket or chat.

Behavior:

- Thread owner sends as `user`.
- Superadmin sends as `admin`.
- Others get `404`.
- Rate limit with scope `support:msg`, 60 messages per minute.
- Validates body or attachments.
- Verifies attachment ownership and existence.
- Inserts message.
- Updates parent thread:
  - `last_message_at`
  - `last_sender_type`
  - `status`
  - unread flags
  - `updated_at`
- User replies reopen `resolved` or `closed` threads.
- Admin replies move `open` threads to `in_progress`.
- User messages notify admin through Telegram.
- Admin replies notify the user through email.
- Writes audit event: `support_message` or `support_reply`.

### `POST /api/support/threads/[id]/read`

Purpose:

- Mark a thread as read for the current side.

Behavior:

- Owner clears `unread_for_user` and writes `user_last_read_at`.
- Superadmin clears `unread_for_admin` and writes `admin_last_read_at`.
- Other callers get `404`.

### `GET /api/support/chat`

Purpose:

- Load the caller's single live-chat thread and messages.

Behavior:

- If no chat thread exists, returns `{ thread: null, messages: [] }`.
- If one exists, messages are returned oldest to newest.
- Attachments are re-signed on read.

### `POST /api/support/chat`

Purpose:

- Send a live-chat message as the current user.

Flow:

1. Validate bearer token.
2. Rate limit with scope `support:msg`, 60 messages per minute.
3. Validate message body or attachments.
4. Resolve workspace, email, and display name.
5. Find or create the caller's single `kind = 'chat'` thread.
6. Verify attachments.
7. Insert message.
8. Update thread unread and last-message fields.
9. Notify admin through Telegram.
10. Write `support_message` audit event.

### `POST /api/support/admin/start-chat`

Purpose:

- Let a superadmin open a live-chat thread with a chosen teammate.

Behavior:

- Requires `superadmin`.
- Rate limit with scope `support:start-chat`, 30 starts per hour.
- Uses `resolve_workspace_member(workspace_id, email)` RPC from migration `0029_support_member_lookup.sql`.
- The target must be an active user in the same workspace.
- Cannot start a chat with self.
- Creates or reuses the target user's single chat thread.
- Returns the thread; the first admin message is sent through `/api/support/threads/[id]/messages`.

## Client Data Layer

Client support state lives in `src/lib/support/use-support.ts`.

The hook exposes:

- `threads`
- `loading`
- `unreadCount`
- `activeThread`
- `activeMessages`
- `refresh()`
- `createTicket()`
- `openThread()`
- `closeThread()`
- `sendMessage()`
- `markRead()`
- `setStatus()`
- `loadChat()`
- `sendChatMessage()`
- `startChatWith()`

Scopes:

- `useSupport("own")`: end-user widget, own threads only.
- `useSupport("all")`: superadmin Support Inbox.

Recent IO hardening:

- The floating support widget now calls `useSupport("own", { enabled: supportEnabled, realtime: supportEnabled })`.
- `supportEnabled` is true only when the widget is open or a support deep link is active.
- This prevents every authenticated page from opening support REST calls and Realtime subscriptions just to render a closed button.
- The admin Support Inbox still opens support data deliberately because the inbox itself is an active support surface.

Realtime subscription:

- Channel name: `support-${scope}-${workspaceId}`.
- Listens to `support_threads` `event: "*"` filtered by `workspace_id`.
- Listens to `support_messages` `event: "INSERT"` filtered by `workspace_id`.
- Client code also checks the active thread id before appending a realtime message.
- RLS still controls which rows are delivered to a given authenticated user.

## UI Surfaces

### Floating Support Widget

Files:

- `src/components/support/support-widget.tsx`
- `src/components/support/support-panel.tsx`
- `src/components/support/ticket-form.tsx`
- `src/components/support/thread-view.tsx`

Behavior:

- Visible to authenticated non-superadmin users.
- Opens a panel with ticket and chat tabs.
- Code-splits the heavy panel with `next/dynamic`.
- Prefetches the panel chunk on hover/focus.
- Does not fetch support data while closed after the IO hardening pass.

### Admin Support Inbox

File:

- `src/components/support/support-inbox.tsx`

Behavior:

- Rendered as a superadmin-only main-sidebar page.
- Lists tickets and chat threads.
- Supports filters by kind and status.
- Supports direct thread selection, replies, status changes, refresh, and start-chat.
- Uses `RecipientPicker` to choose a teammate for admin-initiated chat.

### Sidebar Alert Dot

Files:

- `src/lib/support/use-support-alert.ts`
- `src/app/api/support/alert/route.ts`
- `supabase/migrations/0031_support_alert_indexes.sql`

Behavior:

- Visible only on the superadmin Support Inbox sidebar item.
- Shows a small pulsing dot when `/api/support/alert` reports an unread admin thread or untouched open ticket.
- Clears after `markRead()` or status changes by dispatching `support-alert-refresh`.
- Uses a tiny indexed API check, plus a single `support_threads` realtime listener for immediate new-alert state.
- Falls back to focus/visibility refresh and a 90-second safety refresh.

## Attachment Flow

Attachments are private and are never sent through the Vercel function body.

Upload flow:

1. Browser calls `POST /api/support/uploads` with file metadata.
2. Server validates file count, MIME, and size.
3. Server creates signed upload URLs in Supabase Storage.
4. Browser uploads directly with `supabase.storage.from("support-attachments").uploadToSignedUrl(...)`.
5. Browser sends only `{ storageKey, name }` claims when creating a ticket or message.
6. Server verifies the storage key starts with `{workspaceId}/{userId}/`.
7. Server lists the object from storage and reads actual size/MIME.
8. Server creates a 7-day signed read URL.
9. Message stores attachment metadata in `support_messages.attachments`.

Read flow:

1. Thread detail route reads messages.
2. Server calls `resignAttachments()`.
3. Each stored attachment gets a fresh 7-day signed URL.
4. If re-signing fails, the stored URL is kept rather than dropping the attachment.

Storage bucket:

- Name: `support-attachments`
- Public: false
- File size limit: 25 MB
- MIME allowlist matches `src/lib/support/format.ts`

## Notifications

Notifications only happen after the database write succeeds.

Admin notifications:

- New ticket: SMTP email plus Telegram ping.
- User message on existing ticket/chat: Telegram ping only.
- Telegram uses an inline "Open in portal" button pointed at `/?support=<threadId>`.
- Telegram is one-way only. There is no inbound Telegram webhook.

Operational diagnostic on 2026-05-21:

- Configured portal bot returned username `SMMEngineBot` from Telegram `getMe`.
- Configured admin chat resolved to a private chat labeled `Ace`.
- Telegram `getWebhookInfo` returned no webhook URL.
- A direct diagnostic `sendMessage` to the configured chat succeeded.
- If a phone is watching `ContentEngine_bot`, that is not the bot currently configured in this portal environment.

User notifications:

- Admin reply: SMTP email to the thread owner.
- Email links back to the portal support thread.

Debounce windows:

- Admin ping debounce: 5 minutes via `last_admin_notified_at`.
- User email debounce: 10 minutes via `last_user_notified_at`.

Failure policy:

- Notification failures are logged and swallowed.
- A support ticket or message must not fail because SMTP or Telegram is down.

### SMTP Limit Risk

The current implementation does not send SMTP email on every chat message.

Actual SMTP behavior:

- New ticket: sends one admin email.
- User message in chat or existing ticket: does not send SMTP; it sends a debounced Telegram ping to the admin.
- Admin reply to user: sends SMTP email to the user, debounced per thread for 10 minutes.

So a continuous user chat does not continuously consume SMTP quota. The main SMTP exposure is admin replies: if an admin sends multiple replies in the same thread, only the first reply inside a 10-minute window should email the user because `last_user_notified_at` is updated after a successful email.

Remaining risk:

- Many different active threads can still produce many user emails because the debounce is per thread, not global.
- A failed SMTP send does not update `last_user_notified_at`, so repeated admin replies could retry email until SMTP succeeds.
- New ticket emails are not currently grouped; a flood of new ticket creation could consume admin-notification email quota, though `support:create` rate limits ticket creation to 5 per user per hour.

Hardening options if SMTP quota becomes a real issue:

- Keep chat-user-to-admin notifications Telegram-only, as implemented now.
- Add a global SMTP circuit breaker, for example max N support emails per hour.
- Add a digest mode for admin-ticket notifications.
- Update `last_user_notified_at` before sending user email if quota protection is more important than retrying failed email.
- Add provider-specific telemetry for SMTP sends, failures, and debounce skips.

Required environment variables:

- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_HOST` optional, defaults to Gmail SMTP
- `SMTP_PORT` optional, defaults to 465
- `SUPPORT_NOTIFY_EMAIL` optional, falls back to `SMTP_USER`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ADMIN_CHAT_ID`
- `NEXT_PUBLIC_SITE_URL` for absolute portal links

## Audit Logging

Support audit writes go through `recordSupportAudit()` in `src/lib/support/server.ts`.

It calls:

```ts
admin.rpc("record_audit_event", {
  p_entity_type: "support_ticket",
  p_action: action,
  p_entity_id: threadId,
  p_workspace_id: workspaceId,
  p_metadata: { user_name: actorName, details },
});
```

Actions currently used:

- `ticket_created`
- `support_message`
- `support_reply`
- `support_status_changed`

Audit rows land in `audit_log_v2`, not the legacy `post_audit_logs` table.

## Migrations

Support-specific migrations:

- `0027_support_center.sql`: tables, indexes, RLS, Realtime publication, private storage bucket.
- `0028_support_read_receipts.sql`: read-receipt timestamps and one-chat-per-user unique index.
- `0029_support_member_lookup.sql`: workspace-scoped RPC for admin start-chat recipient resolution.
- `0030_supabase_io_hardening.sql`: removes legacy `post_audit_logs` from Realtime and hardens related Supabase IO paths.
- `0031_support_alert_indexes.sql`: partial indexes for the superadmin sidebar alert dot.

## Operational Notes

### Supabase Disk IO

The support feature can create IO pressure if every authenticated page opens support Realtime while the widget is closed. This was corrected by making the widget cold until opened.

Expected behavior now:

- Closed support widget: no support REST fetch and no support Realtime channel.
- Open support widget: fetches user threads and subscribes while open.
- Admin Support Inbox: fetches and subscribes while the inbox is open.

If Disk IO warnings return, check:

- Supabase Observability -> Data API for `touch_my_presence`, support endpoints, and slow RLS queries.
- Supabase Realtime subscription churn.
- `pg_stat_user_tables` dead tuples for `support_threads`, `support_messages`, and `user_presence`.
- `pg_stat_statements` entries touching `support_threads`, `support_messages`, or Realtime metadata tables.

### Data Retention

There is currently no automatic deletion policy for support threads, messages, or attachments. Threads and messages are durable records. Attachments remain in the private bucket until explicitly deleted or a future retention job is added.

### Failure Modes

Ticket creation:

- If thread insert fails, route returns 500.
- If first message insert fails after thread insert, the route deletes the orphan thread.

Message sending:

- If attachment verification fails, no message is inserted.
- If thread update after message insert fails, the message still exists; Realtime/message reads can still show it, but thread ordering/unread state may lag.

Notifications:

- Email and Telegram failures do not roll back successful support writes.

Realtime:

- Realtime is convenience, not the source of truth.
- Reloading the widget/inbox fetches current state from API routes.

## QA Checklist

Before changing support backend behavior:

1. Create a ticket as a normal user.
2. Confirm the user sees the ticket in the widget.
3. Confirm superadmin sees the ticket in Support Inbox.
4. Reply as superadmin.
5. Confirm the user sees the reply.
6. Reply as user.
7. Confirm superadmin sees the reply.
8. Verify unread flags clear after opening the thread.
9. Verify "Seen" receipt appears after the other side reads.
10. Upload one image attachment and one allowed video attachment.
11. Confirm attachments render after reload.
12. Confirm non-owner users cannot open another user's thread.
13. Confirm admin start-chat can only target active same-workspace users.
14. Confirm closed widget does not create support Realtime subscriptions.
15. Run:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Files To Know

Backend:

- `src/app/api/support/uploads/route.ts`
- `src/app/api/support/threads/route.ts`
- `src/app/api/support/threads/[id]/route.ts`
- `src/app/api/support/threads/[id]/messages/route.ts`
- `src/app/api/support/threads/[id]/read/route.ts`
- `src/app/api/support/chat/route.ts`
- `src/app/api/support/admin/start-chat/route.ts`
- `src/lib/support/server.ts`
- `src/lib/support/types.ts`
- `src/lib/support/format.ts`
- `src/lib/support/telegram.ts`

Client:

- `src/lib/support/use-support.ts`
- `src/components/support/support-widget.tsx`
- `src/components/support/support-panel.tsx`
- `src/components/support/support-inbox.tsx`
- `src/components/support/thread-view.tsx`
- `src/components/support/ticket-form.tsx`
- `src/components/support/recipient-picker.tsx`

Schema:

- `supabase/migrations/0027_support_center.sql`
- `supabase/migrations/0028_support_read_receipts.sql`
- `supabase/migrations/0029_support_member_lookup.sql`
- `supabase/migrations/0030_supabase_io_hardening.sql`
