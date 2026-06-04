# Ten80Ten Content Engine - Full Technical Feature Audit

Generated from repo audit of `src`, `supabase/migrations`, `n8n`, config files, and API routes.

## 0. 2026-06-05 Reach Drag And Manual Posted Delta

| Area | Current behavior |
| --- | --- |
| Card drag surface | Reach content cards are draggable from the whole card surface. The visible grip remains as an affordance, but the dnd-kit `attributes`/`listeners` live on the card root. |
| Manual Posted setting | Settings > Publishing exposes an admin-only `Manual Posted moves` toggle. It persists locally under `manual_posted_moves_enabled` and broadcasts same-tab changes with `reach:manual-posted-moves-changed`. |
| Drag to Posted | Dropping into `Posted` is blocked unless the Settings toggle is enabled and the user is admin-class (`superadmin`, `admin`, `owner`). |
| Posted persistence | Browser Supabase writes to `stage='posted'` remain blocked by migration `0046_post_stage_transition_guard.sql`. Approved manual moves call `POST /api/admin/posts/[id]/manual-posted`, which verifies `requireBearerTeamRole(request, ["superadmin", "admin", "owner"])`, uses the service-role client, writes `stage='posted'` and `posted_at`, and records `manual_posted` audit metadata. |
| Failure behavior | Manual Posted moves are optimistic in the board, then roll back to the previous card object if the service route fails. |
| Verification | `npm run typecheck`, focused iron-law test, full `npm test`, `npm run lint`, `npm run build`, `git diff --check`, and unauthenticated route check passed. Local Playwright drag matrix failed before board render due harness auth/bootstrap, not during drag; cleanup counts were all zero. |

## 1. Product Scope

This app is a private social media content operations portal with:

| Area | Exact feature set |
| --- | --- |
| Content Engine | Kanban board for ideas, approvals, revisions, scheduling, and posted archive. |
| Creator Studio | AI-assisted content plan rows, OpenAI caption/image generation, spend caps, job queue, auto-revision. |
| Publishing | Approved/scheduled post ledger, publish jobs, n8n auto-publisher, posted URL tracking. |
| Media | Google Drive uploads, media library, Drive streaming proxy, source vault, license files. |
| Team | Invites, setup flow, access requests, roles, avatars, presence, last-seen tracking. |
| Brand | Brand playbook, hooks, CTAs, content pillars, visual specs, Studio allowlist. |
| Support | Private support tickets/chat, attachments, admin inbox, unread alerts, email/Telegram notifications. |
| Ops | Health checks, audit logs, rate limiting, Supabase RLS, Realtime, SMTP emails. |

## 2. Stack

| Layer | Current implementation |
| --- | --- |
| Framework | Next.js `16.2.0`, App Router, React `19.2.4`, TypeScript. |
| UI | Tailwind CSS 4, shadcn-style primitives, lucide-react, framer-motion. |
| Drag/drop | `@dnd-kit/core`, `@dnd-kit/sortable`, keyboard sortable support. |
| Backend | Next route handlers under `src/app/api`. |
| Database | Supabase Postgres with migrations `0000` through `0032`. |
| Auth | Supabase Auth, password login, invite links, recovery links, setup route. |
| Storage | Supabase Storage for avatars/support/AI assets, Google Drive for publish media. |
| Emails | Nodemailer SMTP with branded HTML templates. |
| AI | OpenAI Chat Completions JSON schema + Images API, direct `fetch`. |
| Publisher | n8n workflow `ten80ten-auto-publisher-v4.json`. |
| Tests | Vitest, Testing Library, static safety tests, route tests. |

## 3. Deployment And Config

| Feature | Details |
| --- | --- |
| Vercel/Next hosting | App is built as a Next.js app. No `vercel.json` is present in repo. Cron/worker triggers are protected route handlers, not declared in repo config. |
| Images | `next.config.ts` sets `images.unoptimized = true`. |
| Server packages | `serverExternalPackages: ["nodemailer"]`. |
| Security headers | Global `nosniff`, `DENY` frame policy, strict referrer policy, camera/mic/geo disabled, CSP report-only. |
| Service worker | `/sw.js` is registered client-side and served no-cache with `Service-Worker-Allowed: /`. |
| PWA metadata | `public/manifest.json`, app icons, Apple web app metadata, OG image metadata. |
| Site URL | Default `https://smm.ten80ten.com`; env override `NEXT_PUBLIC_SITE_URL`. |

## 4. Environment Variables

Do not expose values. These are key names found in code or `.env.local`.

| Group | Keys |
| --- | --- |
| Supabase client | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| Supabase admin/CLI | `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID` |
| Google Drive | `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_DRIVE_ROOT_FOLDER_ID`, `GOOGLE_DRIVE_IMPERSONATE_EMAIL` |
| SMTP | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` |
| Site/health | `NEXT_PUBLIC_SITE_URL`, `HEALTH_CHECK_SECRET`, `N8N_HEALTH_WEBHOOK_URL` |
| n8n | `N8N_URL`, `N8N_API_KEY` |
| Support alerts | `SUPPORT_NOTIFY_EMAIL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_CHAT_ID` |
| AI | `OPENAI_API_KEY`, `OPENAI_IMAGE_API_KEY`, `OPENAI_TEXT_MODEL`, `OPENAI_IMAGE_MODEL`, `OPENAI_VERIFIER_MODEL`, `OPENAI_PROMPT_VERSION` |
| AI controls | `STUDIO_ENABLED`, `CRON_SECRET`, `AI_WORKER_TRIGGER_SECRET`, `SUPABASE_WEBHOOK_SECRET` |
| AI cost | `OPENAI_DAILY_CAP_USD`, `OPENAI_PER_ROW_CAP_USD`, `NEXT_PUBLIC_OPENAI_DAILY_CAP_USD`, `OPENAI_PRICE_TEXT_IN`, `OPENAI_PRICE_TEXT_OUT`, `OPENAI_PRICE_IMAGE`, `OPENAI_PRICE_VERIFIER_IN`, `OPENAI_PRICE_VERIFIER_OUT` |

## 5. Supabase Core Model

Baseline workspace UUID:

```text
00000000-0000-0000-0000-000000000001
```

All domain rows require `workspace_id uuid not null`. The app must provision workspace membership before querying protected data.

### Enums

| Enum | Values |
| --- | --- |
| `pipeline_stage` | `ideas`, `awaiting_approval`, `revision_needed`, `approved_scheduled`, `posted` |
| `content_type` | `video`, `image`, `carousel`, `reel`, `story` |
| `user_role` initial | `owner`, `admin`, `developer`, `editor`, `viewer`, `specialist`, `technician` |
| `user_role` reconciled | adds `superadmin`, `approver`, `creative_director`, `social_media_specialist`, `video_editor`, `graphic_designer` |
| `invite_status` | `active`, `pending` |

### Tables

| Table | Purpose | Key features |
| --- | --- | --- |
| `posts` | Content cards | Stage, platforms, content type, schedule, caption, hook, checklist, source vault, AI fields, posted tracking. |
| `team_members` | Team directory | Email, role, secondary role, invite status, avatar, phone, joined date. |
| `media_assets` | Media library index | Name, URL, file type, folder, added_by, used_in, workspace_id. |
| `post_comments` | Post comments | Post-linked comments with workspace_id. |
| `brand_playbook` | Brand kit JSON | Hooks, CTAs, content pillars, hashtags, voice, do/don't guardrails, Studio allowlist. |
| `post_audit_logs` | Legacy audit table | Read-only legacy table. Client writes are intentionally blocked. |
| `feature_flags` | Feature switches | Flags for RLS/server auth/RPC writes/Drive/publishing/media/audit/content validation. |
| `workspaces` | Tenant root | Baseline workspace seeded. |
| `workspace_members` | RLS membership gate | User to workspace role/status mapping. |
| `rate_limit_buckets` | Fixed-window rate limiter | Written by RPC only. |
| `abuse_events` | Abuse/security events | Deny-all RLS log table. |
| `audit_log_v2` | Current audit log | Entity/action/actor metadata, read by UI/views. |
| `oauth_accounts` | Publisher auth ledger | Per workspace/platform external account token material. |
| `publish_jobs` | Publish queue | Claim state machine, scheduled_at, retries, worker lock, posted progression. |
| `platform_publish_attempts` | Per-platform result | Idempotency, state, external id, post URL, payload/error. |
| `dead_letter_jobs` | Failed publisher jobs | Permanent failure records. |
| `signup_requests` | Public access requests | Pending/approved/rejected with reviewer fields. |
| `content_plan_rows` | Creator Studio grid | Row schedule/platform/media/format/style/topic/status/generated_post_id/cost. |
| `ai_generation_jobs` | AI job queue | Generate/revise jobs, queued/running/completed/failed/cancelled, claim token, cost. |
| `user_presence` | Last-seen state | Last seen/active for auth users. |
| `support_threads` | Support tickets/chat | User-owned or superadmin-visible private threads. |
| `support_messages` | Support messages | Server-written messages with JSON attachments. |

### RLS And Access

| Rule | Implementation |
| --- | --- |
| Domain table gate | `is_active_workspace_member(workspace_id, roles)` controls most SELECT/INSERT/UPDATE/DELETE. |
| Provisioning | `/api/workspace/provision` self-heals `workspace_members` from `team_members` using service role. |
| Posts/media write roles | superadmin/admin/owner/approver/creative_director/editor/social_media_specialist/video_editor/graphic_designer/specialist. |
| Posts/media delete | superadmin/admin. |
| Comments | Active members can read/insert; author/admin style rules for update/delete. |
| Brand playbook edit | Admin/creative director style roles. |
| Audit | Read via `audit_log_v2`; client writes through `record_audit_event()`. |
| Support | User sees own threads; superadmin sees all; no browser insert/update/delete policies. |
| Rate limits/abuse | Deny browser access; service/RPC only. |

### RPCs And Functions

| Name | Purpose |
| --- | --- |
| `is_active_workspace_member(workspace_id, roles)` | Central RLS membership check. |
| `rate_limit_consume(scope, key, limit, window_seconds)` | Fixed-window endpoint rate limit. |
| `record_audit_event(entity_type, action, entity_id, metadata)` | Current client audit write path. |
| `claim_publish_job(worker_id, claim_seconds)` | Atomic n8n job claim with `FOR UPDATE SKIP LOCKED`. |
| `reclaim_expired_publish_jobs()` | Reclaims expired claimed jobs. |
| `dead_letter_publish_job(job_id, reason)` | Moves failed jobs to dead-letter state. |
| `create_publish_job_for_post(post_id)` | Creates/upserts publish job and platform attempts for scheduled approved post. |
| `touch_my_presence(activity)` | Writes presence heartbeat. |
| `touch_my_presence_throttled()` | 60-second throttled presence ping. |
| `resolve_workspace_member(workspace_id, email)` | Service-role lookup for support admin start-chat. |

### Database Safety Triggers

| Trigger | Table | Safety behavior |
| --- | --- | --- |
| `posts_audit_before_delete` | `posts` | Logs full context to `audit_log_v2` before every delete. |
| `posts_protect_approved_and_posted` | `posts` | Blocks hard-delete of `approved_scheduled` and `posted` posts. |
| `posts_audit_stage_change` | `posts` | Logs every stage transition to `audit_log_v2`. |
| `posts_block_manual_posted` | `posts` | Blocks human/client moves into `posted`; service-role publisher must set `posted_at`. |
| `trg_audit_log_v2_sync_presence` | `audit_log_v2` | Updates `user_presence` from audit events. |
| `update_updated_at` triggers | multiple | Maintains `updated_at`. |

### Views

| View | Purpose |
| --- | --- |
| `v_user_presence_summary` | Team last-seen summary from team/auth/presence/audit. |
| `v_audit_log_with_actor` | Audit read view with actor name resolution. |
| `v_publish_queue` | Settings publishing queue monitor with overdue/stuck/retry data. |

### Supabase Storage

| Bucket | Public | Purpose |
| --- | --- | --- |
| `avatars` | yes | User avatar upload during setup/profile. |
| `support-attachments` | no | Support screenshots/videos, signed upload URLs, 25 MB limit, image/video allowlist. |
| `ai-assets` | no | AI-generated images, 7-day signed URLs, code-required. Migration was not found; create it when cloning. |

### Realtime

| Realtime channel/table | Status |
| --- | --- |
| `brand_playbook` | Added by migration. |
| `media_assets` | Added by migration with replica identity full. |
| `support_threads`, `support_messages` | Added by migration with replica identity full. |
| `team_members`, `post_audit_logs` | Removed/trimmed from Realtime by hardening migrations. |
| `posts` | Client subscribes in `pipeline-context.tsx`; enable in publication when cloning if not already enabled. |
| `content_plan_rows` | Creator Studio subscribes; enable in publication when cloning if not already enabled. |
| Presence channel | Uses Supabase Realtime presence, keyed by email. |

## 6. Content Engine Logic

| Feature | Exact behavior |
| --- | --- |
| Board stages | `ideas`, `awaiting_approval`, `revision_needed`, `approved_scheduled`, `posted`. |
| Platforms | `instagram`, `tiktok`, `facebook`, `youtube`, `linkedin`. |
| Content types | `video`, `image`, `carousel`, `reel`, `story`. |
| Default checklist | Thumbnail approved, caption/hashtags, hook, CTA, brand guidelines, schedule confirmed. |
| Load order | Auth loads, `/api/workspace/provision` runs, then posts query runs. |
| Posts query | Tries `*, publish_jobs(...)`; falls back to `*` if production lacks publish tables. |
| Empty board | Empty DB result is valid and renders empty. It does not fall back to placeholder data. |
| Local fallback | `localStorage` backup is used only on DB error or no Supabase config. |
| Realtime | Handles INSERT/UPDATE/DELETE, scoped by workspace where possible, with mutation dedup. |
| Create post | Optimistic temp card, Google Drive upload first, `posts.insert` always includes `workspace_id`, temp id remaps to UUID. |
| Move post | UUID guard prevents Supabase calls on temp IDs. Rollback on DB error. |
| Approval gate | Moving to `approved_scheduled` requires thumbnail, publish content, caption, design link, all checklist items. |
| Revision gate | Moving to `revision_needed` requires feedback/kickback modal. |
| Fix submitted | `revision_needed` to `awaiting_approval` requires note. |
| Posted stage | UI blocks manual move. DB trigger also blocks clients. Only n8n/service-role publisher may mark posted with `posted_at`. |
| Delete post | Optimistic delete with rollback on DB error. DB blocks approved/posted deletes. |
| Audit | Client calls `record_audit_event`; DB also audits deletes/stage changes. |

## 7. Content UI Features

| Screen/component | Features |
| --- | --- |
| Dashboard | Stage counters, approval rate, content funnel, platform split, upcoming posts, mini calendar, recently published. |
| Content Engine board | DnD columns, card counters, mobile column tabs, keyboard drag, readiness validation, toasts. |
| Cards | Thumbnail/video indicator, platform chips, checklist progress, AI-generated badge, scheduled info. |
| Create Post modal | Tabs for content/checklist/details, platform picker, content type picker, caption with mentions, schedule, raw files, license, design link, Drive folder. |
| Asset drawer | Content tab, source vault tab, audit trail tab, inline edits, comments, mentions, checklist, source files, license, lightbox, delete confirm. |
| Media picker | Upload or choose from media vault, Drive upload progress, asset source required for upload. |
| Calendar | Month grid and mobile agenda with post chips by stage/platform/time/thumbnail. |
| Post Preview | Platform-style previews for Instagram, Facebook, TikTok, YouTube, LinkedIn. |
| Brand Kit | Copy hub, strategy, identity, guardrails, business essentials, hooks, CTAs, schedule, pillars, voice, colors, type, logos, specs, approval chain, proof points. |
| Settings | General, team, themes, audit logs, integrations, Creator Studio health/access, publishing queue, data export placeholder. |

## 8. Team And Auth

| Feature | Exact behavior |
| --- | --- |
| Login | Supabase email/password login. |
| Invite flow | Admin creates Supabase auth user, generates invite link, inserts pending `team_members`, sends branded invite. |
| Setup flow | Invite link lands on `/auth/setup`, sets password, crops/uploads avatar, activates team profile via server route. |
| Password reset | `/api/auth/forgot-password` generates Supabase recovery link and sends branded reset email. |
| Confirm route | `/auth/confirm` verifies invite/recovery token hash and redirects with session fragment; short-lived HttpOnly cookies also set. |
| Access request | Public `/request-access`, anti-enumeration response, inserts `signup_requests`, notifies admins. |
| Approve request | Superadmin approves/rejects; approve creates user, invite link, pending member, branded email. |
| Team management | Invite, resend invite, edit profile/role/phone/avatar, remove member, pending request review. |
| Logout | Supabase global signout plus server cookie clearing route. |
| Roles in UI | superadmin, admin, approver, creative_director, social_media_specialist, video_editor, graphic_designer. |

## 9. Presence

| Feature | Exact behavior |
| --- | --- |
| Live status | Supabase Realtime presence channel keyed by email. |
| Status states | `active`, `idle`, `away`, `offline`. |
| Activity events | mousemove, keydown, click, scroll, touchstart. |
| Heartbeat | Visible tabs call `touch_my_presence` every 5 minutes. |
| Route ping | Route changes call `touch_my_presence_throttled`. |
| Departure | `pagehide` sends beacon to `/api/presence/departure`. |
| Audit sync | Audit inserts update `user_presence`. |
| Summary labels | UI reads `v_user_presence_summary`. |

## 10. Media And Google Drive

| Feature | Exact behavior |
| --- | --- |
| Drive auth | Google service account JSON, optional impersonation, Drive API v3 scopes. |
| Folders | Upload target folders include `thumbnails/`, `raw-files/`, `media-library/`. |
| Small upload | Files under 4 MB use `/api/drive/proxy-upload`. |
| Large upload | Files 4 MB and above use resumable Drive upload session plus `/api/drive/finalize`. |
| Max upload | Client helper caps at 250 MB. |
| Progress | XHR progress for small uploads and direct PUT progress for resumable uploads. |
| Retries | Client retry delays 2s, 8s, 32s. |
| Streaming | `/api/drive/stream?id=...` supports Range requests and same-origin/Bearer auth. |
| Media library | Supabase `media_assets`, filters by folder/type/status/search, grid/list, selection delete with rollback. |
| Lightbox | Image/video preview, keyboard arrows, swipe, copy link, open link. |
| Source vault | Design link, Drive folder, raw files, usage type master/supplementary. |
| License file | Stored in Drive and referenced by `license_file_id`. |

Replication note: `src/lib/drive-upload.ts` finalize path should be verified for large uploads because `/api/drive/finalize` requires Bearer team auth.

## 11. Publishing And n8n

| Feature | Exact behavior |
| --- | --- |
| Publish creation | `/api/publish-jobs` validates auth, membership, UUID, post stage, schedule, then calls `create_publish_job_for_post`. |
| Job states | `pending`, `claimed`, `running`, `partial`, `succeeded`, `failed`, `dead`. |
| Claiming | n8n calls `claim_publish_job`; DB uses row lock and skips locked jobs. |
| Stage gate | Jobs claim only when post is `approved_scheduled`, due, retry time elapsed, and attempts under 3. |
| Attempts | Per-platform attempts record state, external id, post URL, response/error. |
| Posted update | On any platform success, n8n sets post `stage='posted'`, `posted_at=now()`, and `posted_urls`. |
| Retries | Transient all-fail attempts requeue with `next_retry_at = attempts * 5 minutes`; max 3. |
| Dead letters | Permanent/all exhausted failures call `dead_letter_publish_job`. |
| Admin retry | Settings publishing queue can reset a job to clean pending via `/api/admin/publish-jobs/[id]/retry`. |
| Queue monitor | Settings reads `v_publish_queue` and shows stuck/overdue/failed/partial jobs. |

Current n8n workflow:

| File | Purpose |
| --- | --- |
| `n8n/ten80ten-auto-publisher-v4.json` | Current auto-publisher. Schedule every 1 minute. Publishes Facebook, Instagram, LinkedIn. Writes `audit_log_v2`. |
| `n8n/ten80ten-auto-publisher.json` | Older V3 workflow with YouTube/TikTok notes and legacy audit behavior. Keep as historical. |
| `n8n-health-check.json` | Daily 7 AM health check workflow that emails an HTML report. |

## 12. Creator Studio AI

| Feature | Exact behavior |
| --- | --- |
| Access | Requires `STUDIO_ENABLED`, AI writer role, and optional `brand_playbook.data.studioAllowedEmails`. |
| AI writer roles | superadmin, admin, owner, creative_director, social_media_specialist. |
| Row window | UI loads rows from 3 days back to 28 days forward. |
| Row fields | Date, time, platforms, media type, format, slides, aspect, feel, visual style, style prompt, topic, notes. |
| Formats | Image: single/carousel/story. Video: reel/storyboard. |
| Feel options | Educational, Story, Founder POV, Before/After, Contrarian, Hype, Behind-the-Scenes, Testimonial-Style, Announcement, How-To. |
| Visual styles | Photography, Illustration, Infographic, Screenshot Mockup, 3D Render, Mixed Media, Editorial Photo, Studio Photo. |
| Row status | empty, ready, generating, generated, failed, revising. |
| Generation | Single row or batch up to 14 row IDs. |
| Queue | Inserts `ai_generation_jobs`, marks row `generating`, triggers worker endpoint. |
| Worker | Claims queued jobs, generates text, runs hallucination gate, generates images, uploads assets, inserts/updates post, logs audit. |
| Generated post stage | AI posts are inserted as `awaiting_approval`, never scheduled/posted automatically. |
| Auto-revision | Supabase webhook watches AI-originated posts moved to `revision_needed`, enqueues revise job. |
| Cost control | Daily cap default `$10`, per-row cap default `$3`, spend tracked from jobs. |
| Polling | UI polls active job statuses every 3 seconds. |
| Health | Settings panel calls `/api/ai/health` for spend, queued/running/stuck, failures, cap hits, gate failures. |

OpenAI behavior:

| Part | Details |
| --- | --- |
| Text | Chat Completions API, JSON schema response, 30s timeout, 3 retries. |
| Images | Images generation API, one image per call, 90s timeout, 2 retries. |
| Prompt | Brand playbook, recent posts, plan row, hard anti-hallucination rules, strict JSON fields. |
| Hallucination gate | Regex blocks suspect percentages, dollar amounts, bad years, forbidden phrases; optional verifier model. |
| Image storage | Private `ai-assets` bucket, 7-day signed URLs, re-key after real post ID. |

## 13. Support Center

| Feature | Exact behavior |
| --- | --- |
| User widget | Create ticket, live chat, send/read messages, upload attachments. |
| Admin inbox | Superadmin-only support inbox, start chat with teammate, status changes. |
| Thread kinds | `ticket`, `chat`. |
| Statuses | `open`, `in_progress`, `resolved`, `closed`. |
| Privacy | User reads own threads; superadmin reads all; no other team member can read. |
| Writes | All support writes use service-role server routes. |
| Attachments | Signed direct upload to `support-attachments`; server verifies key, size, mime, signed URL. |
| Limits | 5 attachments max, 25 MB each, image/png/jpeg/webp/gif and video/mp4/quicktime. |
| Notifications | Admin SMTP email, optional Telegram ping, debounced user reply email. |
| Unread | `unread_for_user`, `unread_for_admin`, read receipt timestamps. |
| Alert | `/api/support/alert` returns superadmin sidebar alert boolean. |

## 14. SMTP And Designed Emails

| Feature | Exact behavior |
| --- | --- |
| Transport | Nodemailer SMTP, default host `smtp.gmail.com`, port `465`, secure true. |
| From | `"Ten80Ten Social Media Management Portal" <SMTP_USER>`. |
| Site URL | `NEXT_PUBLIC_SITE_URL` or `https://smm.ten80ten.com`. |
| Safety | HTML escaping, subject CR/LF stripping, strict email validation, deduped safe recipients. |
| Wrapper | Responsive max-width card, Ten80Ten logo, footer, gradient headers, CTA buttons. |

Email templates/routes:

| Email | Trigger |
| --- | --- |
| Invite email | `/api/team/invite`, `/api/team/resend-invite`. |
| Access approved email | `/api/team/approve-request`. |
| Password reset | `/api/auth/forgot-password`. |
| Revision requested | `/api/notifications/revision`. |
| Post approved | `/api/notifications/approved`. |
| Awaiting approval | `/api/notifications/awaiting-approval`. |
| Mention notification | `/api/notifications/mention`. |
| Admin access request | `/api/team/request-access`. |
| Support ticket | Support server helper on ticket creation. |
| Support reply | Support server helper on admin reply. |
| Daily health report | `n8n-health-check.json`. |

## 15. API Route Inventory

| Route | Methods | Purpose |
| --- | --- | --- |
| `/api/workspace/provision` | GET | Self-heal active workspace membership before protected reads. |
| `/api/auth/complete-setup` | POST | Activate invite profile, workspace membership, auth metadata. |
| `/api/auth/forgot-password` | POST | Generate Supabase recovery link and SMTP reset email. |
| `/api/auth/logout` | POST | Global logout and clear cookies. |
| `/auth/confirm` | GET | Verify invite/recovery token and redirect to setup/reset. |
| `/api/team/invite` | POST | Admin invite flow. |
| `/api/team/resend-invite` | POST | Recreate pending invite link and email. |
| `/api/team/request-access` | POST | Public access request. |
| `/api/team/approve-request` | POST | Superadmin approve/reject signup request. |
| `/api/team/remove-member` | POST | Admin member removal and auth cleanup. |
| `/api/notifications/awaiting-approval` | POST | Email approvers when post enters approval. |
| `/api/notifications/approved` | POST | Email creator when post is approved/scheduled. |
| `/api/notifications/revision` | POST | Email creator/directors on revision request. |
| `/api/notifications/mention` | POST | Email exact-name `@mentions`. |
| `/api/drive/upload` | POST | Create Drive resumable upload session. |
| `/api/drive/proxy-upload` | POST | Server proxy upload to Drive for smaller files. |
| `/api/drive/finalize` | POST | Make Drive file public and return stream URL. |
| `/api/drive/stream` | GET | Range-capable Drive streaming proxy. |
| `/api/publish-jobs` | POST | Create publish job for approved scheduled post. |
| `/api/admin/publish-jobs/[id]/retry` | POST | Admin reset failed/partial/stuck job to pending. |
| `/api/admin/backfill-media` | POST | Admin backfill `media_assets` from post source files. |
| `/api/ai/studio/access` | GET/PUT | Read/update Studio access and allowlist. |
| `/api/ai/studio/rows` | GET/POST | List/create content plan rows. |
| `/api/ai/studio/rows/[id]` | PATCH/DELETE | Update/delete content plan row. |
| `/api/ai/studio/generate-row/[id]` | POST | Queue one AI generation. |
| `/api/ai/studio/generate-batch` | POST | Queue batch AI generation. |
| `/api/ai/studio/cancel-job/[id]` | POST | Cancel queued AI job. |
| `/api/ai/studio/spend` | GET | Current daily AI spend/cap. |
| `/api/ai/jobs/[id]` | GET | Poll AI job status. |
| `/api/ai/auto-revise/process` | POST | Protected worker processor for queued AI jobs. |
| `/api/ai/auto-revise/webhook` | POST | Supabase webhook for AI post revision requests. |
| `/api/ai/health` | GET | Admin Creator Studio health snapshot. |
| `/api/support/threads` | GET/POST | List/create support tickets. |
| `/api/support/threads/[id]` | GET/PATCH | Read thread or superadmin update status. |
| `/api/support/threads/[id]/messages` | POST | Add support message. |
| `/api/support/threads/[id]/read` | POST | Mark thread read. |
| `/api/support/chat` | GET/POST | Single live-chat thread for user. |
| `/api/support/admin/start-chat` | POST | Superadmin starts chat with teammate. |
| `/api/support/uploads` | POST | Mint support attachment signed upload targets. |
| `/api/support/alert` | GET | Superadmin unread/open support alert. |
| `/api/presence/departure` | POST | Pagehide last-seen beacon. |
| `/api/presence/diag` | GET | Presence diagnostics. |
| `/api/health/deep-check` | GET | Secret-gated 40-check production health audit. |
| `/api/health/integrations` | GET | Secret-gated Supabase/flags/n8n/SMTP probes. |

## 16. Health And Observability

| Feature | Exact behavior |
| --- | --- |
| Deep health | `/api/health/deep-check`, Bearer `HEALTH_CHECK_SECRET`. |
| Integration health | `/api/health/integrations`, header `x-health-token`. |
| Correlation logging | `src/lib/logger.ts` used by health/logout style routes. |
| Health checks | Env, Supabase latency, Drive, site, APIs, RLS, auth consistency, secrets scan, tables, integrity, timestamps, team health, activity, content quality, thumbnails, media, audit, storage, latency, duplicates, freshness, coverage. |
| Grade | `CRITICAL`, `NEEDS ATTENTION`, `MOSTLY HEALTHY`, `ALL CLEAR`. |
| Daily report | n8n calls deep-check at 7 AM and sends HTML report. |
| Creator Studio health | Spend, queue, stuck jobs, failed jobs, gate failures, cap hits, latency. |

## 17. Critical Clone Rules

These are mandatory or posts/support/AI state will break.

| Rule | Required implementation |
| --- | --- |
| Apply migrations | Apply Supabase migrations `0000` through `0032` in order. |
| Workspace ID | Every insert to domain tables must include `workspace_id`. |
| Provision first | Call `/api/workspace/provision` before protected post/team/media reads. |
| Empty posts | Treat `[]` as a valid empty board. Do not replace with placeholder data. |
| UUID guard | Before Supabase `.eq("id", cardId)` on posts, check UUID validity. |
| Audit writes | Use `record_audit_event`; do not client-insert into `post_audit_logs`. |
| Posted stage | Do not allow manual move to `posted`; n8n/service-role only with `posted_at`. |
| Protected delete | Do not bypass triggers blocking approved/posted hard deletes. |
| Publish fallback | Keep `POSTS_SELECT_FULL` to `POSTS_SELECT_BASIC` fallback until publish tables exist in production. |
| Realtime | Enable Realtime for all code-subscribed tables, especially `posts` and `content_plan_rows`. |
| AI storage | Create private `ai-assets` bucket and policies if missing. |
| SMTP | Set SMTP envs or invite/reset/support/notification emails fail. |
| n8n V4 | Configure per-client constants/secrets in workflow nodes before activating. |
| Brand name | User-facing app copy should say Ten80Ten Content Engine, not internal pipeline wording. |

## 18. Test And Maintenance Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Local dev server. |
| `npm run build` | Production build. |
| `npm run lint` | ESLint. |
| `npm run typecheck` | TypeScript check. |
| `npm test` | Vitest suite. |
| `npm run preflight` | Install, lint, typecheck, test, build. |
| `npm run studio:smoke` | Creator Studio smoke script. |
| `npm run db:diff` | Supabase schema diff. |
| `npm run db:types` | Generate Supabase TypeScript types. |
| `npm run db:types:check` | Verify generated DB types. |
