# Plan: Support Center — Discreet Floating Widget

**Date:** 2026-05-20
**Project:** Ten80Ten SMM Portal (`smm.ten80ten.com`)
**Author:** Claude Opus 4.7 (planning session with Aldridge)
**Status:** Awaiting approval. Do not execute until approved.

---

## 0. Locked Decisions (from interview)

| # | Decision | Choice |
|---|---|---|
| 1 | Where the admin replies | **Inside the web app** — a private **Support Inbox tab in Settings**, visible only to the superadmin. Aldridge reads and answers every ticket and chat there. |
| 2 | Telegram's role | **Outbound notification only.** Telegram gets a real-time "you have a message" ping with a link to the dashboard. No bot webhook, no inbound, no routing. |
| 3 | Phasing | **Phase 1 = ticket system** (widget + form + email + Telegram ping + admin inbox). **Phase 2 = live-chat tab** (a small increment reusing Phase 1). |
| 4 | User notification on reply | **In-app unread badge + email** to the user when Aldridge replies (debounced). |
| 5 | Widget look | **Discreet.** A small, muted bottom-right trigger — deliberately less prominent than Facebook's chat bubble. |

### Why the misrouting worry is gone

The earlier concern — a Telegram reply reaching the wrong person — **cannot happen in this design.** Nothing flows *from* Telegram into the system. Telegram only *receives* a short ping. Aldridge clicks the link, lands in the web app, and answers inside a specific thread in his Support Inbox — like opening the right email in Gmail. There is no inbound channel, so there is no routing for the system to get wrong.

The remaining privacy guarantee — one user must never see another user's threads, and only the superadmin sees the full inbox — is enforced in the database (Section 3) and tested.

---

## 1. Requirements Summary

A **discreet** floating support widget pinned bottom-right on every authenticated page.

- **Collapsed:** a small, muted trigger — not a loud bubble. Quiet at rest, gently brightens on hover, a tiny dot when there is an unread reply.
- **Expanded:** a compact Messenger-style panel with two tabs. Default = **Submit a ticket**. Second = **Chat with the tech team** (Phase 2).
- **Ticket flow:** pick an issue type, attach screenshots/video, describe the issue, send. A confirmation says to expect a reply in 24-48 hours.
- **On a new ticket/message** Aldridge gets a formatted **email** (tickets) and a real-time **Telegram ping** — both deep-link to the thread.
- **Aldridge answers in the Support Inbox** — a private tab inside Settings, visible only to him. One place for every ticket and chat message.
- **User sees the reply** live (Realtime), with an unread badge, plus an email if the widget is closed.
- **Privacy:** a user's threads are visible only to that user and the superadmin — enforced by RLS and on the realtime wire.
- **Attachments:** images and video in a private Supabase Storage bucket, served via signed URLs.

### Non-goals
- No inbound Telegram / no bot webhook / no Telegram replies.
- No inbound-email parsing.
- No public/pre-login support (the portal is auth-gated; the widget renders only after login).
- No multi-tenant work — but every new table carries `workspace_id` so the feature is multi-tenant-ready.

---

## 2. Architecture Overview

```
END USER (web dashboard)              ALDRIDGE / SUPERADMIN (web dashboard)
  │ discreet floating widget            │ Settings → "Support Inbox" tab
  │  - Submit a ticket  (Phase 1)       │   (superadmin-only)
  │  - Chat tab         (Phase 2)       │  - all tickets + all chats
  ▼                                     │  - thread detail, reply, status
        /api/support/*  Next.js route handlers
        - requireBearerUser auth, rate-limited (consume()), service-role writes
  ▼
 Supabase Postgres
   support_threads   (RLS: visible to owner OR the superadmin)
   support_messages  (RLS: via parent thread)
   support-attachments bucket (private; signed URLs)
  │
  ├─► Supabase Realtime (postgres_changes, RLS-filtered) → live updates + unread badge, both sides
  ├─► nodemailer (Gmail SMTP) → ticket email to Aldridge; reply-notification email to user
  └─► Telegram Bot API → ONE-WAY ping to Aldridge (sendMessage + a URL button to the thread).
        No webhook. No inbound. He clicks through and answers in the Support Inbox.
```

### Reuses (no new infrastructure)
- **Email:** `src/lib/email-utils.ts` — `getTransporter()`, `getFromAddress()`, `esc()`, `safeSubject()`, `wrapEmail()` pattern, brand orange `#ea580c`/`#f59e0b`.
- **Auth:** `requireBearerUser()` / `requireBearerTeamRole()` from `src/lib/auth/require.ts`.
- **Rate limiting:** `consume()` + `getClientIp()` from `src/lib/rate-limit.ts`.
- **Audit:** `record_audit_event` RPC (migration 0009).
- **RLS helper:** `is_active_workspace_member(workspace_id, roles[])` (migration 0007).
- **Storage pattern:** private bucket + signed URLs, modeled on `src/lib/ai/upload.ts` (`ai-assets`).
- **Realtime:** `supabase.channel(...).on("postgres_changes", ...)` from `src/lib/pipeline-context.tsx:399`; publication setup from migration 0017.
- **Settings tab pattern:** the role-gated `audit` tab in `src/components/pages/settings-page.tsx:374`.
- **Deep-link pattern:** `pendingOpenPostId` / `navigateToPost` in `src/lib/navigation-context.tsx:31`.
- **UI:** `@base-ui/react`, Tailwind 4, `framer-motion`, `lucide-react`, `useToast()`.

---

## 3. Data Model — Migration `0027_support_center.sql`

> **Numbering note:** the CTO multi-tenant brief reserves `0027_multi_tenant_completion.sql` (not yet written). It should renumber to `0028`; support takes `0027` because it ships first. (Open item — confirm.)

```sql
-- 0027_support_center.sql
-- Support Center: per-user private support threads (tickets + chat).
-- RLS: a thread is visible to its creator and to the superadmin, no one else.
-- All writes go through server routes using the service-role client; there are
-- NO authenticated INSERT/UPDATE/DELETE policies (mirrors audit_log_v2).

create table if not exists support_threads (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references workspaces(id) on delete cascade,
  created_by            uuid references auth.users(id) on delete set null,
  created_by_email      text not null,
  created_by_name       text not null,
  kind                  text not null check (kind in ('ticket','chat')),
  subject               text,
  category              text,
  status                text not null default 'open'
                          check (status in ('open','in_progress','resolved','closed')),
  last_message_at       timestamptz not null default now(),
  last_sender_type      text,
  unread_for_user       boolean not null default false,
  unread_for_admin      boolean not null default true,
  last_user_notified_at  timestamptz,   -- debounce: reply-notification emails to the user
  last_admin_notified_at timestamptz,   -- debounce: Telegram pings to Aldridge
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table if not exists support_messages (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid not null references support_threads(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  sender_type text not null check (sender_type in ('user','admin','system')),
  sender_name text not null,
  body        text,
  attachments jsonb not null default '[]'::jsonb,  -- [{storageKey,signedUrl,mime,name,size,kind}]
  created_at  timestamptz not null default now()
);

create index support_threads_owner_idx   on support_threads(created_by, last_message_at desc);
create index support_threads_ws_idx      on support_threads(workspace_id, status, last_message_at desc);
create index support_messages_thread_idx on support_messages(thread_id, created_at);

alter table support_threads  enable row level security;
alter table support_messages enable row level security;

-- READ: own threads, or any workspace thread if the caller is the superadmin.
-- (Superadmin-only by request — "only me can see". Widen the array to add
--  support staff later.)
create policy support_threads_select on support_threads for select using (
  is_active_workspace_member(workspace_id, null)
  and (created_by = auth.uid()
       or is_active_workspace_member(workspace_id, array['superadmin']))
);

create policy support_messages_select on support_messages for select using (
  is_active_workspace_member(workspace_id, null)
  and exists (
    select 1 from support_threads t
    where t.id = support_messages.thread_id
      and (t.created_by = auth.uid()
           or is_active_workspace_member(t.workspace_id, array['superadmin']))
  )
);
-- No INSERT / UPDATE / DELETE policies. Service role bypasses RLS for all writes.

-- Realtime (guarded; pattern from 0017_media_assets_realtime.sql)
do $$ begin
  if not exists (select 1 from pg_publication_tables
                 where pubname='supabase_realtime' and tablename='support_threads')
  then alter publication supabase_realtime add table support_threads; end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname='supabase_realtime' and tablename='support_messages')
  then alter publication supabase_realtime add table support_messages; end if;
end $$;
alter table support_threads  replica identity full;
alter table support_messages replica identity full;

-- Private storage bucket. No public policies — server-only access via service role.
insert into storage.buckets (id, name, public)
values ('support-attachments', 'support-attachments', false)
on conflict (id) do nothing;
```

- **Short code** (e.g. `A1B2`): first 6 hex chars of `id`, uppercased, derived in code. No column.
- **Iron-law compliance:** `workspace_id NOT NULL` on every row (rule 2); audit via `record_audit_event` (rule 3); `isValidUuid()` guard on every route `[id]` param (rule 5).
- **Deployment:** apply to production Supabase (`lczmgquuzuqhalasjnip`) before the widget is enabled. Additive only.

---

## 4. Phase 1 — Ticket System

### 4.1 Shared server helpers — `src/lib/support/server.ts` (new)
- `getAdminClient()` — service-role client (inline factory, the established route pattern).
- `resolveWorkspaceId(admin, userId)` — caller's active `workspace_members` row; baseline UUID fallback.
- `resolveUserIdentity(admin, email)` — name from `team_members`.
- `uploadAttachments({admin, workspaceId, threadId, messageId, files})` — validates mime + size, uploads to `support-attachments/{workspaceId}/{threadId}/{messageId}-{n}.{ext}`, returns metadata with 7-day signed URLs (mirrors `src/lib/ai/upload.ts`).
- `notifyAdminOfTicket(thread, firstMessage)` — sends the ticket email **and** the Telegram ping.
- `notifyAdminOfMessage(thread, message)` — Telegram ping for a new user message, debounced via `last_admin_notified_at` (≥5 min gap).
- `notifyUserOfReply(thread, message)` — reply-notification email to the user, debounced via `last_user_notified_at` (≥10 min gap).

**Attachment limits:** mime allowlist `image/png|jpeg|webp|gif`, `video/mp4|quicktime`; per-file ≤ 25 MB; ≤ 5 files per message. Rejected → 400 with a clear message.

### 4.2 Telegram ping — `src/lib/support/telegram.ts` (new)
- `pingTelegram({ text, threadUrl })` — `POST https://api.telegram.org/bot<TOKEN>/sendMessage` with `chat_id = TELEGRAM_ADMIN_CHAT_ID`, the text, and an inline-keyboard URL button "Open in portal" → `threadUrl`.
- One-way only. On any failure: log and continue — the DB write + email already succeeded, so the user request never fails because of Telegram.
- **Setup (one-time, ~1 min):** create a bot via BotFather → `TELEGRAM_BOT_TOKEN`; message the bot once and read the chat id → `TELEGRAM_ADMIN_CHAT_ID`. No webhook, no group, no topics.

### 4.3 API routes (all `runtime = nodejs`, `maxDuration = 60`)
| Route | Method | Auth | Purpose |
|---|---|---|---|
| `src/app/api/support/threads/route.ts` | `GET` | `requireBearerUser` | List caller's threads. `?scope=all` → `requireBearerTeamRole(req, ['superadmin'])`, all workspace threads. |
| | `POST` | `requireBearerUser` | Create a thread (multipart). Rate limit `consume("support:create", userId, 5, 3600)`. Fires `notifyAdminOfTicket`. |
| `src/app/api/support/threads/[id]/route.ts` | `GET` | `requireBearerUser` | Thread + messages. `isValidUuid(id)` guard. |
| | `PATCH` | `requireBearerTeamRole(['superadmin'])` | Set `status`. |
| `src/app/api/support/threads/[id]/messages/route.ts` | `POST` | `requireBearerUser` | Append a message (multipart). Rate limit `consume("support:msg", userId, 60, 60)`. A `user` message fires `notifyAdminOfMessage`; an `admin` message (superadmin only) sets `unread_for_user=true` and fires `notifyUserOfReply`. |
| `src/app/api/support/threads/[id]/read/route.ts` | `POST` | `requireBearerUser` | Clear `unread_for_user` (user) or `unread_for_admin` (superadmin). |

All writes use the service-role client. `record_audit_event` on create / reply / status change (`p_entity_type='support_ticket'`, `p_entity_id=thread.id`). `isValidUuid()` before every `.eq("id", ...)`.

### 4.4 Email templates — add to `src/lib/email-utils.ts`
- `buildSupportTicketEmailHtml({ shortCode, userName, userEmail, category, body, attachments, threadUrl })` — dark header + orange accent, modeled on `buildAdminNotificationHtml`. Attachments as signed-URL links with inline `<img>` previews. Sent to `SUPPORT_NOTIFY_EMAIL` (fallback `SMTP_USER`); `Reply-To` = the user's email (validated).
- `buildSupportReplyEmailHtml({ userName, shortCode, replyPreview, threadUrl })` — "You have a reply" notice to the user.

All interpolation through `esc()`; subjects through `safeSubject()`.

### 4.5 The widget — `src/components/support/` (new)

**Discreet collapsed trigger** (the key visual ask — "not noticeable, unlike Facebook"):
- Bottom-right, sitting above the existing 32 px footer bar.
- A small muted pill or icon button — neutral surface (`bg-white` / `dark:bg-[#1a1a1a]`), thin subtle border, a small `lucide` help icon (e.g. `LifeBuoy`), optional tiny "Support" label. **No** orange gradient, **no** large circle.
- Quiet at rest (slightly translucent, ~36 px tall); gently brightens and lifts on hover.
- Unread reply → a small ~8 px orange dot, not a big red number. Count appears on hover/open.

**Expanded panel:**
- Compact Messenger-style card (~360 × 520 px), bottom-right, `rounded-2xl`, soft shadow, subtle border; opens with a `framer-motion` spring from the corner.
- Header: small "Support" title + collapse control. Tabs: **Submit a ticket** (default) and **Chat** (Phase 2).
- `ticket-form.tsx` — issue-type chips (Bug / Question / Billing / Other), attach control with thumbnail previews, description textarea, **Send**. After send: a success card — "Ticket sent. Our tech team will reply within 24-48 hours." — and the ticket drops into the **Your tickets** list.
- `thread-view.tsx` — message list + composer; reused by the admin inbox and the Phase 2 chat tab.

**Files:** `support-widget.tsx`, `ticket-form.tsx`, `thread-view.tsx`, and `src/lib/support/use-support.ts` (client hook: thread fetch, Realtime subscription, unread count).

**Mount:** `src/components/app-shell.tsx` `DashboardLayout`, as a sibling of `<ToastContainer />` inside `TeamProvider` — has `useAuth()` + `useToast()`, renders only when authenticated. No sidebar nav item is added.

**Client data:** `useAuth()` → `accessToken`, `currentUser.{name,email}`, `provisionResult.workspaceId`. Realtime subscribes to `support_threads`/`support_messages` filtered `workspace_id=eq.{wsId}`; RLS narrows delivery to the user's own threads (the superadmin receives all) — the same filter+RLS model as the `posts` subscription, so no user receives another user's message on the wire.

**Mobile (hard rule):** below 768 px the open panel is full-screen (`h-dvh`, `inset-0`), composer sticky-bottom, tap targets ≥ 44 px. Verified at 375 px before any push.

**Copy:** consumer-plain, no dev jargon; product named "Content Engine" where referenced (AGENTS.md rule 6).

### 4.6 Admin Support Inbox — a private tab in Settings

The admin surface is a new **Support Inbox** tab inside the existing `SettingsPage`, visible **only to the superadmin** — Aldridge's private view of every ticket and chat. No new sidebar item, no new `Page`.

- `src/components/support/support-inbox.tsx` (new) — thread list (all workspace threads, both kinds; unread-first; filter Tickets / Chats / All and by status), thread detail reusing `thread-view.tsx`, a reply composer with attachments, and a status control.
- `src/components/pages/settings-page.tsx` (edit) — extend the `activeTab` union (`settings-page.tsx:244`) from `"general" | "team" | "audit" | "themes"` to add `"support"`; add the tab entry conditionally on `isSuperadmin` (`settings-page.tsx:241`), exactly mirroring how the `audit` tab is gated by `canViewAudit` (`settings-page.tsx:374`), with an unread-count badge; add the `activeTab === "support"` render branch (`settings-page.tsx:385`). Icon: `Inbox` or `LifeBuoy`.
- Opening a thread clears `unread_for_admin`; sending a reply inserts an `admin` message, sets `unread_for_user=true`, and fires `notifyUserOfReply`. Realtime keeps the list live.

**Deep link:** Telegram pings and reply emails link to `smm.ten80ten.com/?support=<threadId>`. On load: the **superadmin** is routed to Settings → Support Inbox → that thread, via a `pendingSupportThreadId` added to `src/lib/navigation-context.tsx` (small change, mirroring the existing `pendingOpenPostId` / `navigateToPost` / `clearPendingPost` mechanism at `navigation-context.tsx:31`); a **regular user** has the widget open straight to that thread (handled in `use-support.ts`, no navigation change).

### 4.7 Phase 1 Acceptance Criteria
1. Submitting a ticket (issue type + 2 MB screenshot + description) inserts one `support_threads` row (`kind='ticket'`) and one `support_messages` row, uploads the file under `support-attachments/{workspaceId}/{threadId}/`, returns 200 — integration test.
2. The ticket email reaches `SUPPORT_NOTIFY_EMAIL` (short code in subject, working signed screenshot link) **and** a Telegram ping arrives with an "Open in portal" button — manual check.
3. After send, the widget shows the 24-48 hour confirmation; the ticket appears in **Your tickets** as `open`.
4. As User B, `select * from support_messages` (anon JWT) returns **0 rows** for User A's thread; the superadmin returns all — RLS integration test with a two-user fixture.
5. The **Support Inbox** tab is visible only when the signed-in user is a superadmin; other roles never see it, and `GET /api/support/threads?scope=all` returns 403 for them — integration test.
6. A superadmin reply sets `unread_for_user=true`, reaches the user's widget via Realtime within 2 s, and sends exactly one reply email (none again within 10 min) — integration test + manual check.
7. The collapsed trigger is visually discreet (no orange gradient, ≤ ~36 px, muted at rest) and the panel at 375 px is full-height with a sticky composer and ≥ 44 px targets — manual review in DevTools.
8. `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` all pass.

---

## 5. Phase 2 — Live-Chat Tab

A small increment — it reuses everything from Phase 1.

- `support-widget.tsx` gains the **Chat with the tech team** tab: a single persistent `kind='chat'` thread per user, created lazily on the first message, rendered with the existing `thread-view.tsx` + Realtime.
- New user chat messages fire `notifyAdminOfMessage` (Telegram ping, debounced — no email per line).
- Aldridge answers chat threads in the **same Support Inbox** tab; the filter separates Tickets from Chats. Replies notify the user (badge + email) exactly as tickets do.
- No schema change — `kind='chat'` already exists in migration `0027`.

### Phase 2 Acceptance Criteria
1. The first chat message creates one `support_threads` row (`kind='chat'`) and is reused for every later message — integration test.
2. A user chat message produces at most one Telegram ping per 5 minutes per thread — integration test.
3. A superadmin chat reply reaches the user's widget via Realtime within 2 s — manual check.
4. Lint, typecheck, test, build all pass.

---

## 6. Environment Variables

| Variable | Phase | Notes |
|---|---|---|
| `SUPPORT_NOTIFY_EMAIL` | 1 | Aldridge's inbox for ticket emails. Falls back to `SMTP_USER`. |
| `TELEGRAM_BOT_TOKEN` | 1 | From BotFather. |
| `TELEGRAM_ADMIN_CHAT_ID` | 1 | Aldridge's Telegram chat id (one-way ping target). |

Reused as-is: `SMTP_*`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. New vars set in Vercel.

---

## 7. Risks & Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| A user sees another user's threads in-app or on the realtime wire | Critical | Owner-scoped RLS on both tables; Realtime `postgres_changes` enforces RLS via the subscriber JWT. Two-user RLS fixture test (AC 4.7.4). |
| A non-superadmin reaches the admin inbox | High | RLS admin clause is `array['superadmin']` only; the Settings tab is gated by `isSuperadmin`; `?scope=all` requires `requireBearerTeamRole(['superadmin'])`. Tested (AC 4.7.5). |
| Telegram reply reaches the wrong user | — | **Eliminated by design** — Telegram is outbound-only; no inbound channel, no routing. |
| Migration `0027` collides with the reserved multi-tenant `0027` | Medium | Support takes `0027` (ships first); the unwritten multi-tenant migration renumbers to `0028`. Open item below. |
| Production Supabase missing migration `0027` → support queries fail | Medium | Migration applied to prod as an explicit deploy step before the widget is enabled. |
| Telegram API outage blocks ticket submission | Low | The ping runs after the DB write + email; failure is logged and swallowed — the user request still succeeds. |
| Attachment abuse (oversize, wrong type, spam) | Low | Mime allowlist, per-file + per-message caps, `consume()` rate limits (create 5/hr, messages 60/min). |
| Editing the 1600-line `settings-page.tsx` introduces a regression | Low | The change is additive and localized — one `activeTab` value, one conditional tab entry, one render branch — following the existing `audit`-tab pattern. `SupportInbox` is a self-contained imported component. |

---

## 8. Verification Steps

1. **Static:** `npm run lint && npm run typecheck && npm test && npm run build` — zero errors.
2. **Migration:** apply `0027` to a Supabase branch; confirm tables, indexes, RLS policies, publication membership, and the storage bucket exist.
3. **RLS proof:** two-user fixture — User A creates a thread; assert User B's `select` returns 0 rows and the superadmin's returns all.
4. **Phase 1 manual:** submit a ticket with a screenshot → confirm DB rows, the email, the Telegram ping, the in-widget confirmation; open the Settings → Support Inbox tab as superadmin, reply → confirm the user's badge, the live update, and one reply email; confirm the tab is absent for a non-superadmin account.
5. **Discreet + mobile:** confirm the collapsed trigger is muted/small; exercise the widget at 375 px in DevTools (full-height panel, sticky composer, 44 px targets).
6. **Phase 2:** open a chat, exchange messages, confirm live delivery and debounced Telegram pings.

---

## 9. File Manifest

**Phase 1 (new):** `supabase/migrations/0027_support_center.sql`; `src/lib/support/{server.ts,telegram.ts,types.ts,format.ts,use-support.ts}`; `src/app/api/support/threads/route.ts`, `.../threads/[id]/route.ts`, `.../threads/[id]/messages/route.ts`, `.../threads/[id]/read/route.ts`; `src/components/support/{support-widget.tsx,ticket-form.tsx,thread-view.tsx,support-inbox.tsx}`; tests under `src/lib/support/__tests__/`.
**Phase 1 (edit):** `src/lib/email-utils.ts` (two templates); `src/components/app-shell.tsx` (mount the widget); `src/components/pages/settings-page.tsx` (the superadmin Support Inbox tab); `src/lib/navigation-context.tsx` (`pendingSupportThreadId` deep-link mechanism).
**Phase 2 (edit):** `src/components/support/support-widget.tsx` (chat tab). The message route already covers `kind='chat'`. No new files, no migration.

---

## 10. Open Items for Aldridge

1. **Migration numbering** — confirm support takes `0027` and the future multi-tenant migration becomes `0028`.
2. **Issue-type chips** — confirm: Bug / Question / Billing / Other (easy to change).
3. **`SUPPORT_NOTIFY_EMAIL`** — which inbox should ticket emails go to?
4. **Discreet trigger** — a small pill with a "Support" label, or an icon-only button? (The plan defaults to a small labelled pill.)
5. **Inbox access** — superadmin-only as requested. To add a support teammate later, widen the RLS array and the tab gate (one-line change each).

---

## 11. Recommended Execution Order (Phase 1)

1. Migration `0027` + apply to a Supabase branch.
2. `src/lib/support/{types,format,server,telegram}.ts` + the two email templates.
3. API routes + route tests.
4. The widget (`support-widget`, `ticket-form`, `thread-view`, `use-support`) + mount in `app-shell`; tune the discreet trigger.
5. `support-inbox.tsx` + the superadmin Support Inbox tab in `settings-page.tsx` + the `?support=` deep link.
6. Full verification pass (Section 8, steps 1-5).

Phase 2 (the chat tab) follows as a small separate increment once Phase 1 is verified.
```
