# The Reach Clone Progress

Phase: IN PROGRESS - production-readiness QA and Reach polish
Last pushed SHA: 897571c fix: harden drive media access
Next: Fix team removal hierarchy, request-access enumeration/null-workspace gaps, then continue UI/accessibility and full production QA.
Blockers: None. `supabase status`/local DB diff still require Docker if needed.

QA swarm / audit normalization slice notes:

- Treated the latest audit screenshot as an additive QA item while keeping the production-readiness goal active.
- Spawned three read-only QA agents for pipeline, brand/dashboard UI, and auth/support/media/ops; captured their findings as backlog items for the next slices.
- Root cause for the screenshot: migration `0038` only normalized the newer `Reach launch cleanup removed ...` rows. Earlier cleanup rows used `Removed <email> from team, workspace access, and auth`, so the audit view still showed `aldridge@ten80ten.com`.
- Added migration `0039_reach_cleanup_audit_actor_normalization.sql` and applied it to production Supabase project `gxmpmdhmxyfqusdzcemt`.
- Added the app-side audit guard for known cloned/test cleanup emails in both cleanup wording formats, while leaving ordinary member removals attributed to the real actor.
- Production verification passed through `v_audit_log_with_actor`: cloned/test cleanup rows for Christer, Alex, Carlo, Muaaz, Hanes, and Shang now resolve to `SYSTEM`; the unrelated `themanekinekogirl@gmail.com` removal still resolves to Aldridge because it was not a launch clone/test cleanup row.
- Verification passed: focused setup/static test, `npm run typecheck`, `git diff --check`, `npm run lint` with only existing warnings, `npm run build`, `supabase db push`, and remote migration list showing `0039`.
- Pushed commit `b0da6c7` to `origin/main`; GitHub CI is running.

Pipeline realtime / notification hardening slice notes:

- Treated the QA swarm pipeline findings as root issues in the active production-readiness goal.
- Touched `src/lib/pipeline-context.tsx` deliberately after re-checking the AGENTS iron-law requirements: provision remains before posts SELECT, empty DB results still render an empty board, `createCard` still always writes `workspace_id`, and id-keyed Supabase writes remain UUID-guarded.
- Fixed the baseline realtime subscription risk by initializing internal workspace subscription state to `null`, setting it after provision/fallback, and driving the Realtime effect from that state instead of `workspaceIdRef.current`.
- Fixed canonical Realtime updates by applying every `UPDATE` payload from Supabase and clearing the local mutation mark instead of suppressing same-id updates for 10 seconds. This prevents peer and n8n publisher updates, including `posted`, from being ignored.
- Hardened revision kickback flow so `requestKickback()` and `submitKickback()` reject temporary post IDs while a new card is still saving.
- Added a shared authenticated notification helper for pipeline notification routes. Approved, awaiting-approval, revision, and mention notifications now attach a Supabase bearer token and log non-2xx responses instead of silently swallowing 401s.
- Hardened asset drawer comment mentions with the same bearer token and non-2xx response check.
- Added static regression coverage for workspace-state Realtime subscription, canonical Realtime updates, kickback temp-ID guards, and authenticated notification routes.
- Verification passed: focused iron-law tests (16), `npm run typecheck`, `git diff --check`, `npm run lint` with one existing AI worker warning, full `npm test` with 28 files / 247 tests, and `npm run build`.
- Pushed commit `0424dec` to `origin/main`; GitHub CI is running.

Drive media access hardening slice notes:

- Treated the Drive findings from the ops/security QA agent as root security issues, not UI polish.
- Hardened `/api/drive/stream`: bearer-authenticated requests still pass directly; same-origin media-tag fallback is now bounded to Drive file IDs already referenced by app data or physically inside app-managed Drive folders. A forged Referer can no longer stream arbitrary service-account-visible Drive files.
- Hardened `/api/drive/finalize`: the route now reads Drive metadata and verifies the file parent belongs to one of the app-managed folders before calling `setPublicPermission(fileId)`.
- Hardened `/api/drive/proxy-upload`: files above 4 MB are rejected before `file.arrayBuffer()`, forcing the existing resumable upload path instead of buffering large media through the app server.
- Updated Google Drive metadata reads to include parent folders and added a central `MAX_DRIVE_PROXY_FILE_SIZE`.
- Added static Drive security tests for stream fallback, finalize permission order, and proxy upload threshold.
- Verification passed: focused Drive route tests (10), `npm run typecheck`, `git diff --check`, `npm run lint` with one existing AI worker warning, full `npm test` with 29 files / 250 tests, and `npm run build`.
- Pushed commit `897571c` to `origin/main`; GitHub CI is running.

Auth / team access hardening slice notes:

- Treated the latest auth/team complaint as a root-cause hardening pass, not a redirect from the active goal.
- Kept `src/lib/pipeline-context.tsx` untouched.
- Patched authenticated sessions to revalidate workspace/team access on same-user Supabase token refresh, browser focus, visibility recovery, and every 60 seconds while visible. Removed/revoked users should no longer keep a stale active gate until a full reload.
- Patched Settings team state to use Supabase Realtime invalidation for `team_members` and `signup_requests`, then reload through the existing RLS-protected SELECT paths.
- Added and applied migration `0037_reach_team_access_realtime.sql`; production Realtime publication now includes `team_members` and `signup_requests`, and both tables use `REPLICA IDENTITY FULL`.
- Hardened request approval ordering: approval now validates role/email, rejects duplicate team emails, cleans orphan Auth/workspace rows with checked errors, creates Auth + team row, finalizes the request, and only then sends/copies the invite link. If request finalization fails, the newly-created team/Auth state is rolled back.
- Hardened request rejection so a failed status update returns a real error instead of fake success.
- Hardened member removal so team/workspace access revocation stays successful even if Supabase Auth deletion fails after access has already been removed. The API reports `authCleanupPending` and reinvite cleanup can retry stale Auth cleanup later.
- Fixed the production launch-cleanup audit rows shown in Settings: the three `Reach launch cleanup removed ...` entries now store `metadata.user_name = SYSTEM`.
- Added app-side audit display guard so future `Reach launch cleanup removed ...` member-removal rows display as `SYSTEM` even if metadata is written incorrectly.
- Verification passed: focused auth/team/audit tests with 39 tests, `npm run typecheck`, `git diff --check`, full `npm run lint` with only existing warnings, full `npm test` with 28 files / 243 tests, and `npm run build`.
- Production Supabase verification passed: `team_members` and `signup_requests` are in `supabase_realtime`; the screenshot cleanup audit rows now read `SYSTEM`.

Request-access / team refresh root-fix notes:

- Investigated the reported 6 AM request-access submission that showed `Request Submitted` but did not appear in email or Settings.
- Verified production `signup_requests` had 0 rows, so the submitted request did not persist.
- Root cause: `/api/team/request-access` inherited the Ten80Ten anti-enumeration pattern that logged insert failures but still returned HTTP 200. That can show the success screen while creating no Supabase row and sending no admin notification.
- Patched `/api/team/request-access` so DB persistence is authoritative: insert errors now return HTTP 500, existing team emails return HTTP 409 with a clear message, duplicate pending requests return `already_pending`, and successful requests include the baseline workspace UUID.
- Request-access admin notification is now awaited after a successful insert. SMTP failure no longer loses the saved request; the response reports `emailSent: false` while the request remains visible in Settings.
- Added audit logging for `access_request_submitted`.
- Added Settings/Team refresh hardening: pending requests refresh on focus, visibility, and every 60 seconds while open; invite, approve/reject, and resend success paths explicitly refresh Supabase-backed team/pending state.
- Added focused request-access regression coverage: successful insert includes workspace id, insert failure is not a fake success, existing team email is a real conflict, duplicate pending requests do not insert twice, and SMTP failure keeps the saved request.
- Verification passed: focused team/auth tests, `npm run typecheck`, `npm run lint` with only existing warnings, full `npm test` with 27 files / 237 tests, and `npm run build`.
- Pushed commit `f79b594` to `origin/main`; GitHub CI passed lint, typecheck, tests, and build. Vercel production deployment is ready.
- Production proof on `https://thereach.ten80ten.com`: controlled request-access probe returned HTTP 200 with `status: pending`, created exactly 1 `signup_requests` row with workspace `00000000-0000-0000-0000-000000000001`, reported `emailSent: true` to 1 admin recipient, then the QA row was deleted. Production pending request count is back to 0 after cleanup.

Support Inbox production smoke notes:

- Verified Support Inbox/chat on the live domain with an authenticated `aldridge@ten80ten.com` superadmin session.
- Admin support list returned HTTP 200 with 1 existing workspace thread.
- Superadmin thread detail returned HTTP 200 and loaded the existing thread messages.
- Own support list returned HTTP 200 with 0 own threads, which is correct for Aldridge's own user account.
- Own live-chat load returned HTTP 200 with no thread and 0 messages, which is the correct empty initial chat state.
- Admin start-chat with self returned HTTP 400 `You cannot start a support chat with yourself.`, matching the route guard.
- Admin start-chat with removed/inactive `hanes@ten80ten.com` returned HTTP 400 `That teammate has not activated their account yet, so they cannot receive a message.`, matching the cleaned production team state.
- A successful admin-to-teammate chat cannot be production-tested while Aldridge is the only active member; it should be tested immediately after the next invite completes setup with a profile photo.

Brand Playbook copy-card elevation slice notes:

- Treated the latest Brand Playbook screenshot as an additional visual QA task, not a redirect from the active production-readiness work.
- Root issue: copy cards were still mostly Sand-on-Sand, so Business Essentials, Hashtag Banks, Proven Hooks, CTAs, and Caption Templates blended into the page background.
- Added central Reach-token-derived raised-surface variables for light mode; no new brand hex values were introduced.
- Updated the shared `reach-copy-card` surface to render lighter, with stronger Stone border separation and deeper layered elevation.
- Added a `reach-copy-icon` hook so the copy icon chip has visible contrast inside the lighter card and Sun-tinted hover behavior.
- Kept the change scoped to `src/app/globals.css` and `src/components/copy-block.tsx`; no data, auth, support, Drive, pipeline, or Supabase behavior changed.
- Verification passed: `git diff --check`, `npm run typecheck`, `npm run lint` with only existing warnings, and `npm run build`.
- Pushed functional commit `1b57a08` and tracking commit `67cb69d` to `origin/main`; GitHub CI passed for the latest tree.
- Vercel production is ready, and a live CSS bundle check against `https://thereach.ten80ten.com` confirmed the deployed app includes `--reach-raised-surface`, `--reach-raised-surface-hover`, `reach-copy-card`, and `reach-copy-icon`.

Settings / Brand Playbook UI cleanup slice notes:

- Removed the Notion integration card from Settings; no user-facing Notion integration remains in the visible integrations list.
- Updated Settings system rows so real wired systems are marked Active/Monitored instead of Coming Soon: auto-publish, email notifications, post reminders, and team activity.
- Left Analytics tracking as Coming Soon because this slice did not find a real analytics persistence/reporting feature behind that row.
- Verified Settings `Hashtag sets` and `Caption templates` Manage buttons already route to Brand Kit Copy Hub with exact `hashtags` / `captions` focus targets; no route change was needed.
- Added central `reach-copy-card` styling for Brand Playbook copy blocks so Business Essentials, Hashtag Banks, Proven Hooks, CTAs, and Caption Templates render on a lighter elevated surface with stronger Reach Stone borders and shadows.
- Used existing Reach tokens only: Sand, Stone, Sun, and token mixes with existing white surface treatment. No new brand hex values were introduced.
- Verification passed: `git diff --check`, `npm run typecheck`, `npm run lint` with only existing warnings, and `npm run build`.
- Pushed commit `e658660` to `origin/main`; GitHub CI passed lint, typecheck, tests, and build.
- Vercel production deployment `dpl_FnJETeprE7sE3U7f72kbmqz8NccL` is ready and aliased to `https://thereach.ten80ten.com`.

Pipeline drag-handle root-fix slice notes:

- Verified live Reach demo posts have all drag gate fields populated: schedule date/time, thumbnail, source vault raw files, caption, asset source, design link, and checked checklist.
- Compared Reach against the Ten80Ten mothership files. `kanban-board.tsx` and `pipeline-column.tsx` are effectively aligned; the meaningful drift was `content-card.tsx`.
- Restored the Ten80Ten drag contract: the dnd-kit `attributes` and `listeners` are back on a real `button` handle with `aria-label="Drag card"` instead of a pointer-events-disabled decorative handle.
- Kept card body click behavior for opening the drawer and disabled native image dragging on card thumbnails so browser image drag cannot steal the gesture.
- Left `src/lib/pipeline-context.tsx` untouched; no persistence, RLS, audit, or stage transition contract changes were made.
- Added a static regression test that fails if the drag handle stops being a real listener button or becomes a `pointer-events-none` decoration again.
- Verification passed: focused iron-law/static tests, `npm run typecheck`, `npm run lint` with only existing warnings, full `npm test` with 26 files / 232 tests, and `npm run build`.
- Pushed commit `a17861a` to `origin/main`; GitHub CI passed lint, typecheck, tests, and build.
- Vercel production deployment `dpl_5DUQkRveJqhjnFmctSLA7v81eFdd` is ready and aliased to `https://thereach.ten80ten.com`.

Dashboard fit/density slice notes:

- Verified the live production dashboard at a 2048x1192 viewport with a one-time superadmin Supabase magic-link session. The dashboard viewport is filled, but the stretched card rows leave large internal dead zones.
- Removed the shared forced `h-full` from the dashboard card wrapper so cards use grid/flex row sizing instead of always stretching from the component root.
- Stopped forcing the summary row to consume viewport flex height; only the lower operational row can absorb remaining dashboard height.
- Distributed existing content inside Content Funnel, Platform Split, Upcoming Posts, Calendar, and Recently Published cards so tall viewports use available space more deliberately.
- Adjusted the desktop auto-fit scale floor from the clipping-prone 0.8 behavior to a lower 0.72 readability floor so 1280x720 viewports fit instead of hiding lower cards behind the footer.
- No data, pipeline, auth, Supabase, or support behavior changed.
- Verification passed: `npm run typecheck`, `npm run lint` with only existing warnings, full `npm test` with 26 files / 232 tests, and `npm run build`.
- Pushed dashboard fit commits `f646411`, `144c46a`, and final correction `5fb733e` to `origin/main`; GitHub CI passed lint, typecheck, tests, and build for `5fb733e`.
- Vercel production deployment `dpl_F9MbsVF19BuF1K8AdVPa8zYnGCZQ` is ready and aliased to `https://thereach.ten80ten.com`.
- Production screenshot checks captured `2048x1192` and `1280x720` live dashboard views with one-time superadmin Supabase magic-link sessions.

Team/invite production cleanup notes:

- Verified live Reach team state before cleanup: Aldridge active with avatar; Hanes active with avatar; Shahannie active without avatar; Christer pending without avatar.
- Used the existing remove-member cleanup contract directly with service-role authority: delete workspace access by Auth user id, delete `team_members` row by id/email, delete Supabase Auth user, and write best-effort audit.
- Removed cloned/test users `christer@ten80ten.com`, `hanes@ten80ten.com`, and `shang.ten80ten@gmail.com` from production team rows, workspace access, and Auth.
- Verified live post-cleanup state: exactly one `team_members` row remains (`aldridge@ten80ten.com`, `superadmin`, `active`, avatar present); exactly one active `workspace_members` row remains for the baseline workspace; removed emails have no Auth users.
- Reinvites for those emails are now clean and will pass through the hardened setup flow that requires a profile photo before workspace activation.
- Production health after cleanup passed using the correct `Authorization: Bearer <HEALTH_CHECK_SECRET>` contract: `/api/health/keep-alive` returned HTTP 200 `ok: true`; `/api/health/deep-check` returned HTTP 200 with 40 checks, 0 failures, and 0 warnings.

Reach command-button contrast slice notes:

- Hardened central light-theme command-button foregrounds so Sand-tinted labels are brighter on Reach Sun/Stone/Water action backgrounds.
- Extended the central action selector to cover `bg-primary` / `text-primary-foreground` buttons, not only old orange/blue utility classes.
- Raised disabled primary-action readability from washed-out opacity to a readable disabled state with explicit foreground, `-webkit-text-fill-color`, and cursor handling.
- Added the existing `reach-action-button` / `reach-secondary-action` classes to primary commands in login, forgot-password, reset-password, setup, request-access, create-post, avatar crop, revision, repurpose, and support ticket/chat surfaces.
- Verification passed: `git diff --check`, `npm run typecheck`, `npm run lint` with only existing warnings, and `npm run build`.
- Pushed commit `64dd5b8` to `origin/main`; GitHub CI passed lint, typecheck, tests, and build.
- Vercel production deployment `dpl_6rwRBoBCpcyM6bUj2Wg8p9pu7Q3n` is ready and aliased to `https://thereach.ten80ten.com`.

Support Inbox schema/access root-fix slice notes:

- Reproduced the live production failure with an authenticated Aldridge session: `/api/support/threads?scope=all` returned the Hanes live chat thread, but `/api/support/threads/bd7d3d91-6823-4713-9e18-3304e59e66d6` and `/read` returned `404`.
- Verified the live Reach schema root cause: `workspace_members.id` does not exist, while `workspace_members.workspace_id` does exist.
- Patched `getTeamRole()` to select `workspace_id` from `workspace_members`, matching the live schema and the already-working `requireBearerTeamRole()` helper.
- Updated support helper tests so the mock workspace membership shape matches the real Reach schema.
- Kept this slice out of Settings, branding, and pipeline code. `src/lib/pipeline-context.tsx` remains untouched.
- Verification passed locally: focused support helper/API tests, `npm run typecheck`, `npm run lint` with only existing warnings, `npm test` with 26 files / 231 tests, and `npm run build`.
- Pushed commit `d82c490` to `origin/main`; GitHub CI passed lint, typecheck, tests, and build.
- Vercel production deployment `dpl_AFz3i9e4T7TEh55L2ngmLbv88ZMz` is ready and aliased to `https://thereach.ten80ten.com`.
- Production verification after deploy passed for the same Hanes chat thread: support list returned HTTP 200 with the target thread, detail returned HTTP 200 with 0 messages, and read receipt returned HTTP 200.
- Production full chat-flow verification passed after deploy: admin start-chat with `hanes@ten80ten.com` returned HTTP 200 using the existing thread, Hanes load-chat returned HTTP 200, Hanes send-chat returned HTTP 200 with message `97d422a2-b3cd-489b-a725-e5dcfe0e2d45`, admin reload returned HTTP 200 and saw that message, and admin read returned HTTP 200.

Reach button contrast / demo-health slice notes:

- Verified the live Reach site tokens against `https://thereach.travel/`: Sand `#E1DFD5`, Stone `#6C655A`, Sun `#975428`, and the site interaction pattern `hover:bg-sun` with `hover:text-sand`.
- Added central light-theme dashed-upload button rules so upload/dropzone controls use visible Stone/Sun text, stronger Stone/Sun borders, and elevated Sand surfaces instead of cream-on-cream labels.
- Marked Media Library upload buttons and the Media Picker "Use This Asset" button with `reach-action-button` so primary upload/select commands remain readable before hover and while disabled.
- Added migration `0036_reach_demo_health_cleanup.sql` and applied it to the linked Reach Supabase project. Seeded demo posts now use `Aldridge Dagos` as creator and have no future `created_at` timestamps.
- Updated deep-check pipeline flow analysis so future-dated draft/revision cards are treated as valid planned work, because the Create Post contract captures schedule fields before approval.
- Verification passed locally: `npm run typecheck`, `npm run lint` with only existing warnings, `npm test` with 26 files / 231 tests, and `npm run build`.

Reach invite/setup photo-required slice notes:

- Patched `/auth/setup` to match the Ten80Ten setup contract more closely: users can click the setup button, but missing profile photo now produces the explicit error `Please add a profile photo.` instead of allowing activation.
- Patched `/api/auth/complete-setup` so the server refuses workspace activation when the member has no existing avatar and no newly uploaded safe avatar URL.
- Preserved setup recovery from an already-consumed invite session, so pending users who clicked an invite link once can still open Complete Setup and finish correctly.
- Existing active users without photos should be deleted/reinvited now that production has the stricter setup guard live.
- Verification passed: focused auth/setup route tests, `npm run typecheck`, `npm run lint` with only existing warnings, `npm test` with 26 files / 231 tests, `npm run build`, GitHub CI green, and Vercel production ready on `thereach.ten80ten.com`.

Reach client manual cost/savings slice notes:

- Updated `docs/THE-REACH-SMM-CLIENT-MANUAL.html` with a dedicated cost comparison under "Why this portal beats generic tools for The Reach."
- Added the key positioning: The Reach portal is `$0/month` separate software cost because it is included in the full social media package.
- Added current competitor cost examples and annual savings math: Later Growth for 3 users `$495/year`, Later Scale `$990/year`, and Hootsuite 3-user starting baseline approximately `$3,564/year`.
- Added caveat that savings estimates exclude taxes, ad spend, payment processing changes, add-ons, and future competitor pricing changes.
- Verification passed: HTML structural check, off-brand scan, and source review against current Later pricing and Hootsuite plans/pricing pages.

Reach invite/setup recovery slice notes:

- Root cause confirmed in live Supabase: Hanes and Shahannie had consumed/confirmed invite Auth sessions, but their `team_members` rows stayed `pending` and no `workspace_members` rows existed, so the app correctly blocked them at the pending-access gate.
- Patched the pending-access gate to show `Complete Setup` for pending invite users instead of only `Refresh`/`Sign Out`.
- Patched `/auth/setup` so an interrupted invite setup can resume from an existing Supabase session after the invite token hash has already been consumed.
- Made setup avatar upload non-blocking so a storage hiccup cannot strand a confirmed invite user as pending without workspace access.
- Live repair completed for `hanes@ten80ten.com` and `shang.ten80ten@gmail.com`: both are now active `team_members` with active baseline `workspace_members` rows. `christer@ten80ten.com` remains pending because the Auth email is unconfirmed and has never signed in.
- Verification passed: focused auth/setup/provision tests, `npm run typecheck`, `npm run lint` with only existing warnings, `npm test` with 26 files / 230 tests, `npm run build`, GitHub CI green, and Vercel production ready on `thereach.ten80ten.com`.

Reach Media Library usage reconciliation slice notes:

- Patched Media Library usage detection so an asset is considered in use when either `media_assets.used_in` references a card or any live pipeline card points at the asset URL through `thumbnailUrl` or `sourceVault.rawFiles`.
- Kept the change out of `src/lib/pipeline-context.tsx`; post persistence, Realtime subscriptions, drag behavior, and workspace insert rules remain untouched.
- Ignored temporary `blob:` URLs and deduplicated repeated card references so upload previews and repeated references do not create false usage rows.
- Fixed `unused` and `in use` Media Library filters to use the reconciled usage map instead of trusting only the persisted `used_in` array.
- Verification passed: `npm run typecheck`, `npm run lint` with only existing warnings, `npm test` with 26 files / 228 tests, and `npm run build`.

Reach realtime / keep-alive proof slice notes:

- Added migration `0035_reach_realtime_contract.sql` to repo-proof the Realtime contract for `posts` and `content_plan_rows`.
- Applied migration `0035` to linked Reach Supabase project `gxmpmdhmxyfqusdzcemt` with `supabase db push --linked --include-all`.
- Verified live `supabase_realtime` publication contains `public.posts` and `public.content_plan_rows`.
- Verified live `posts` and `content_plan_rows` both use `REPLICA IDENTITY FULL`, so update/delete realtime payloads carry complete row data.
- Confirmed keep-alive schedule is every 2 days in both `vercel.json` and `.github/workflows/supabase-keep-alive.yml`.
- Production keep-alive returned HTTP 200 with counts: 1 workspace, 24 posts, 6 media assets, 32 audit events.
- Production deep-check returned HTTP 200: 40 total checks, 34 pass, 6 warnings, 0 failures, grade `NEEDS ATTENTION`.
- `supabase migration list --linked` hung after applying `0035`; direct SQL and the successful `db push` verified the live state, and the hung CLI process was killed.

Reach Drive upload policy hardening slice notes:

- Added shared Drive media policy constants for valid folders, allowed active-team roles, allowed image/video MIME types, MIME normalization, and the 250 MB media size ceiling.
- Applied the same folder, role, MIME, and size policy to both `/api/drive/proxy-upload` and `/api/drive/upload`, closing the resumable-upload gap where unsupported file types could still mint Google upload sessions.
- Updated the client Drive upload helper to normalize MIME types and reject unsupported/oversize files before starting proxy or resumable upload work.
- Added route tests proving unsupported MIME types and oversize files return `415`/`413` before `ensureSubfolder()` or `createResumableUploadSession()` can run.
- Verification passed: focused Drive route tests, `npm run lint` with only existing warnings, `npm run typecheck`, `npm test` with 26 files / 228 tests, and production `npm run build`.

Reach drawer revision flow hardening slice notes:

- Rebound the inline drawer "Submit Revision Request" action to the existing `submitKickback()` pipeline contract instead of manually appending notes, moving stage, and firing notification routes.
- Kept the drawer UI intact while moving persistence, rollback, audit, mention notifications, and revision notifications back under the guarded pipeline path.
- Removed the drawer-side split-write notification path that could produce mismatched notes/stage/email behavior if one operation succeeded and another failed.
- Added an iron-law static regression test proving drawer revision submits call `submitKickback()` and do not reintroduce manual `updateCard(...notes)` + `moveCard(...revision_needed)` + revision-email writes.
- Verification passed: focused iron-law test, `npm run lint` with only existing warnings, `npm run typecheck`, `npm test` with 25 files / 225 tests, and production `npm run build`.

Reach action button contrast hardening slice notes:

- Reworked the central light-theme action controls to use darker Reach-token-derived Sun/Stone and Water/Stone gradients instead of low-contrast cream-on-cream states.
- Added explicit `background-color`, `background-image`, foreground color, `-webkit-text-fill-color`, stacking, and design-theme selectors for `reach-action-button` and `reach-secondary-action`.
- Raised disabled action controls from low opacity to a readable desaturated/contrast-adjusted state, so primary labels do not disappear when a button is unavailable.
- Verified computed contrast for primary and secondary gradients is about 6:1 or stronger at both gradient endpoints.
- Verification passed: `npm run lint` with only existing warnings, `npm run typecheck`, `npm test` with 25 files / 224 tests, and production `npm run build`.
- Build artifact inspection confirmed the generated CSS includes the stronger Reach action-button selectors and foreground rules.

Reach support access hardening slice notes:

- Added `resolveActiveSupportWorkspace()` for user-facing support APIs. It requires both active `workspace_members` access and an active `team_members` row matching the Auth email.
- Hardened `/api/support/threads` user list/create, `/api/support/chat` read/send, and `/api/support/uploads` signed-upload minting to return `403` instead of falling back to the baseline workspace for pending/orphan Auth sessions.
- Kept superadmin support inbox behavior intact; `scope=all` remains gated by `requireBearerTeamRole(["superadmin"])` and uses the verified workspace id from the auth helper.
- Added focused coverage proving ticket list/create, chat read/send, and upload URL minting are blocked before write helpers run when the Auth user lacks active support access.
- Verification passed: focused support tests, `npm run typecheck`, `npm run lint` with the repo's existing two warnings, production `npm run build`, and full `npm run preflight` with 25 files / 224 tests.

Reach profile / role sync hardening slice notes:

- Added `POST /api/team/update-member` so Settings profile and role edits now run through a service-role API route instead of direct browser writes to `team_members`.
- Role changes for active members now update both `team_members.role` and `workspace_members.role`, preserving the server/API role gate used by `requireBearerTeamRole`.
- The route updates matching Supabase Auth user metadata for name, phone, avatar, and role so invite/setup/profile enrichment remains aligned.
- The route blocks non-superadmins from editing superadmins and blocks invalid role payloads.
- On workspace/Auth reconciliation failure, the route rolls back the `team_members` update and, for role changes, attempts to restore the previous workspace role.
- `TeamContext.updateMember` now awaits `/api/team/update-member`, rolls optimistic UI back on server failure, and no longer has a direct Supabase mutation path for profile/role edits.
- Removed the old browser-side role-change audit write; role/profile audit now comes from the verified server route.
- Added focused route coverage for active role sync, superadmin edit blocking, workspace failure rollback, missing active Auth rejection, and pending invite metadata updates.
- Verification passed: focused team/auth tests, `npm run typecheck`, `npm run lint` with the repo's existing two warnings, production `npm run build`, and full `npm run preflight` with 24 files / 220 tests.

Reach email-change / action-button hardening slice notes:

- Added final Reach action-button classes after design-mode CSS overrides so primary and secondary command buttons keep readable Reach Sand labels/icons before hover.
- Applied the explicit action classes to the dashboard `Review Posts` CTA, Settings Invite/Send Invite/Approve/Resend controls, and Settings profile save/upload controls.
- Added `POST /api/team/change-email` with service-role reconciliation across Supabase Auth, `team_members`, `support_threads.created_by_email`, post/media creator labels, and audit logging.
- Active users can change only their own sign-in email; the route preserves the Auth user id and returns `requiresSignIn` so the client signs out for a fresh Supabase session.
- Pending invite emails can be corrected by admins; the route creates a fresh pending Auth user, generates a new `/auth/confirm?...type=invite` link, invalidates the old pending Auth user, and carries updated pending invite name/role metadata.
- Removed `email` from the generic `updateMember` DB update path so future profile edits cannot drift `team_members.email` away from Supabase Auth.
- Settings now lets any active user open their own row to change sign-in email without granting self role edits; active non-self email edits are blocked to avoid breaking another live session.
- Added focused route coverage for active self-change, duplicate rejection, active non-self rejection, pending invite regeneration, and Auth rollback on DB failure.
- Verification passed: focused auth/team tests, `npm run typecheck`, `npm run lint` with the repo's existing two warnings, production `npm run build`, and full `npm run preflight` with 23 files / 215 tests.

Reach action-button readability slice notes:

- Added a central light-theme action-button rule so primary colored/gradient buttons keep Reach Sand text and icons before hover, including old blue/indigo/orange/yellow class paths still used around the app.
- Kept disabled primary buttons readable by reducing the disabled opacity floor to `0.68` for colored action buttons instead of washing labels into the Sand background.
- Hardened the Settings team Invite and Send Invite buttons directly to Reach Water backgrounds with Reach Sand labels.
- Hardened pending invite Resend buttons directly to Reach Sun backgrounds with Reach Sand labels and readable loading spinner borders.
- No invite/reinvite/team/auth logic changed; this is visual readability only.
- Verified `npm run typecheck` passed.
- Verified `npm run lint` passed with only the repo's existing warnings in untouched `src/lib/ai/worker.ts` and `src/lib/pipeline-context.tsx`.

Reach client manual slice notes:

- Created `docs/THE-REACH-SMM-CLIENT-MANUAL.html` as a standalone, OneCompiler-compatible, mobile-responsive client manual with inline CSS and no build/runtime dependency.
- Used only The Reach brand palette from the guidelines: Sand, Stone, Sun, and Water. The manual uses a text wordmark instead of relying on local logo paths.
- Added restrained luxury motion: animated brand line, editorial ticker, subtle panel sheen, animated chart bars, and `prefers-reduced-motion` support. Removed atmospheric radial decoration to keep the design editorial and on-brand.
- Included operational sections for Dashboard, Content Pipeline, Create Post, platform/content-type compatibility, Media Library, Google Drive 60 TB backend, Post Preview, mentions, support tickets/chat, Brand Kit, Settings, admin controls, Realtime, and keep-alive/deep health.
- Included a realistic comparison against Later and Hootsuite using current official Later/Hootsuite sources checked via web research.
- Verified old-brand/off-brand scan is clean for `Ten80Ten`, `Content Engine`, `Creator Studio`, `smm.ten80ten`, `purple`, `orb`, and `bokeh`.
- Verified HTML tag balance with a direct Node structural check. The system `tidy` binary is a 2006 build and flags HTML5 semantic tags as unknown, so it is not useful for this document.

Reach dashboard / Brand Playbook visual slice notes:

- Confirmed the prior Drive/media hardening commit `78482ac` passed GitHub CI.
- Changed the dashboard page from fixed-content stacking to a height-aware flex layout so large desktop screens do not leave a dead band below the dashboard cards.
- Made dashboard card wrappers fill their row height and kept the welcome banner as a fixed-height header, so the funnel, scorecard, platform split, calendar, upcoming, and archive panels use the available viewport.
- Added explicit high-contrast Reach Sand text color to the `Review Posts` CTA so it remains visible in light mode without relying on hover.
- Renamed the mobile/top-bar pipeline title to `Content Pipeline` to match the sidebar label.
- Improved Brand Playbook hierarchy: header icon, logo asset cards, and approval-chain panels now use stronger Reach Sand/Stone elevation instead of low-contrast flat panels.
- Reworked the approval-chain step badges to use the Reach palette directly: Sun, Water, Stone, and Sand text. No new brand hex values were introduced.
- Verified `npm run typecheck` passed.
- Verified `npm run lint` passed with only the repo's existing warnings in untouched `src/lib/ai/worker.ts` and `src/lib/pipeline-context.tsx`.

Drive / Media Library wiring hardening slice notes:

- Fixed the large-file Drive upload path: `/api/drive/finalize` requires bearer team auth, so the client resumable upload flow now sends the current Supabase bearer headers during finalize.
- Hardened `/api/drive/upload` and `/api/drive/proxy-upload` from "any Auth user" to the shared active team/workspace role gate via `requireBearerTeamRole`, preventing pending/stale Auth users from writing to the 60TB Drive backend.
- Kept the existing Drive upload folder allow-list: `thumbnails`, `raw-files`, and `media-library`.
- Patched `MediaPicker` so Create Post → Browse Library loads `media_assets` from Supabase, subscribes to Realtime updates, and merges preuploaded Media Library assets with post-attached source vault files.
- Patched Media Library uploads to save rows under `Media Library` and use the baseline workspace fallback if `workspaceId` is still hydrating, preserving AGENTS.md workspace insert rules.
- Added a visible error toast if a file reaches Drive but the `media_assets` row insert fails, instead of silently pretending the library save worked.
- Verified `npm run typecheck` passed.
- Verified `npm run lint` passed with only the repo's existing warnings in untouched `src/lib/ai/worker.ts` and `src/lib/pipeline-context.tsx`.

Reach light-theme / design polish slice notes:

- Changed theme localStorage keys to Reach-specific keys so old Ten80Ten/browser state cannot force dark mode or decorative design themes in the Reach app.
- Kept Reach light mode as the default unless this app has an explicit saved preference or Supabase `team_members.theme_preference` returns a valid `light`/`dark` value.
- Reworked the central Reach light-theme token layer so page background, card surfaces, input surfaces, borders, muted text, and shadows have visible hierarchy instead of flattening to one Sand color.
- Preserved brand colors from the guidelines only: Sand, Stone, Sun, and Water. No invented brand hex values were introduced.
- Improved Create Post and Settings readability through central input/textarea/select/dashed-upload styles: stronger Stone borders, darker inset cream fields, visible placeholders, and Sun focus rings.
- Scoped card elevation to real card/panel surfaces so small Brand Kit icons and badges do not become oversized glowing cards.
- Mapped blue/indigo action buttons to Reach Water and orange/yellow action buttons to Reach Sun while preserving high-contrast light text for primary actions like Review Posts, Create Post, invite, support, and media upload.
- Verified `npm run typecheck` passed.
- Verified `npm run lint` passed with only the repo's existing warnings in untouched `src/lib/ai/worker.ts` and `src/lib/pipeline-context.tsx`.

Support Inbox / last-seen hardening slice notes:

- Hardened support thread detail, reply, and read-receipt routes so non-owner admin access now requires both an active `team_members` row and an active `workspace_members` row for the authenticated user.
- Kept owner access unchanged: a thread creator can still open, reply to, and clear their own support unread state.
- Preserved the existing no-leak behavior for unauthorized support thread access by returning `404` instead of exposing thread existence.
- Added focused unit coverage for active superadmin access, pending/inactive team denial, and missing workspace-membership denial.
- Verified focused support behavior with `npx vitest run src/lib/support/__tests__/support-helpers.test.ts src/app/api/support/admin/start-chat/__tests__/route.test.ts`: 14 tests passed.
- Verified `npm run typecheck` passed.
- Verified `npm run lint` passed with only the repo's existing warnings in untouched `src/lib/ai/worker.ts` and `src/lib/pipeline-context.tsx`.

Demo-data slice notes:

- Added migration `0034_reach_demo_posts_ready.sql` and applied it to linked Reach Supabase project `gxmpmdhmxyfqusdzcemt`.
- Filled seeded dummy cards only with required demo fields: scheduled date/time, caption, asset source, source vault design link, raw file entry, creator, and all checklist items checked.
- Converted three seeded archive rows into `Demo Archive Post 1-3` dated May 2026 so the Archive view has demoable posted content under the app's existing "posted before current week" rule.
- Renamed the remaining seeded archive rows to `Sample Posted Content 3-5`, leaving five current-week posted cards for the dashboard's Recently Published panel.
- Live Supabase verification after migration: 24 demo cards total, stage counts are 4 ideas / 4 awaiting approval / 4 revision needed / 4 approved scheduled / 8 posted, archive count is 3, current posted count is 5, and missing required demo fields count is 0.

Visual, pipeline, and keep-alive slice notes:

- Replaced the sidebar square logo with the single-line Reach wordmark pulled from `thereach.travel`; the collapsed sidebar uses a small text mark instead of the square logo.
- Changed the sidebar pipeline nav label from `The Reach` to `Content Pipeline`.
- Added a central Reach light-theme palette layer so white app surfaces resolve to Reach Sand `#E1DFD5`, primary text resolves to Stone `#6C655A`, and orange/yellow accents resolve to Reach Sun `#975428`.
- Updated the Brand Kit logo assets section to show downloadable wordmark variants from the Reach site asset: Sun, Sand, and Stone.
- Wired Settings `Hashtag sets` and `Caption templates` buttons into the Brand Kit Copy Hub with direct section focus instead of coming-soon toasts.
- Restored pipeline drag behavior to a whole-card drag model with protected child controls, while keeping the visible grip handle as an affordance.
- Kept `src/lib/pipeline-context.tsx` untouched; existing Ten80Ten realtime post subscriptions and revision/kickback rules remain authoritative.
- Added `/api/health/keep-alive`, a secret-gated read-only Supabase keep-alive probe for `workspaces`, `posts`, `media_assets`, and `audit_log_v2`.
- Added both Vercel cron config and a GitHub Actions scheduled workflow to ping the live keep-alive endpoint every two days.
- Set the GitHub Actions `HEALTH_CHECK_SECRET` repository secret from `.env.local` without printing the secret.
- Verification passed: `npm run lint` with the repo's existing two warnings, `npm run typecheck`, `npm test` with 22 files / 207 tests, and `npm run build`.

Production-readiness data/auth slice notes:

- Added migration `0033_reach_production_data_cleanup.sql` and applied it to linked Reach Supabase project `gxmpmdhmxyfqusdzcemt`.
- The migration keeps future resets clone-clean by deleting old Ten80Ten default team members, keeping `aldridge@ten80ten.com` as active `superadmin`, cleaning old sample media owner names, setting Brand Kit website data to `www.thereach.travel`, and rebasing all seeded sample cards to June 2026.
- Live Supabase verification after migration: team has only `aldridge@ten80ten.com`, stale media owner count is 0, 24 sample posts exist, non-June sample count is 0, date range is 2026-06-01 through 2026-06-19, and Brand Kit website is `www.thereach.travel`.
- Hardened bearer team-admin checks to require both active `workspace_members` access and an active `team_members` profile before admin routes can proceed.
- Hardened `/api/team/remove-member` so `memberId` and `memberEmail` must resolve to the same row before workspace/auth cleanup, preventing stale UI payloads from deleting the wrong user.
- Renamed the offline team cache key to `reach_team_members` so old Ten80Ten localStorage cannot rehydrate a Reach team list if Supabase is unavailable.
- Verification passed: `npx vitest run src/lib/auth/__tests__/require.test.ts src/app/api/team/remove-member/__tests__/route.test.ts` with 7 tests passing.

Forgot-password/auth-user clone fix notes:

- Root cause confirmed in the live Reach Supabase project: `aldridge@ten80ten.com` exists as active `superadmin` in `team_members`, but the new Supabase project had zero Auth users, so password login and recovery had no Auth identity to operate on.
- Patched `/api/auth/forgot-password` to preserve the normal reset flow for existing Auth users and add a silent self-service setup bridge for known `team_members` rows with `status in ('active','pending')` when a recovery link cannot be generated.
- The bridge creates the missing Supabase Auth user with a temporary password, generates a token-hash invite link, and sends the existing branded Reach setup email through `/auth/confirm` -> `/auth/setup`. If a previous setup-email attempt already created the Auth user, it skips deletion and still generates a fresh setup link.
- Unknown emails still return the same `{ success: true }` response and do not create Auth users, preserving the anti-enumeration behavior.
- Recovery and invite token hashes are URL-encoded before being placed in `/auth/confirm`.
- Verification passed: focused forgot-password tests, auth setup tests, resend-invite tests, setup-flow static tests, and full `npm run preflight` with 202 tests and production build. A post-hardening focused forgot-password run passed 4 tests.
- Pushed to `origin/main`; Vercel deployed production `dpl_GgP5iCDvKEyZPKgAg8U36oq9kygb` and aliased `https://thereach.ten80ten.com`.
- Production `/api/auth/forgot-password` was triggered for `aldridge@ten80ten.com` and returned `{ success: true }`.
- Vercel logs show the forgot-password POST and no error-level logs for the deployment after the request.
- Supabase now has one Auth user for `aldridge@ten80ten.com` with `superadmin` metadata. Email is unconfirmed and `workspace_members` is still absent until setup completion, which is the expected pre-click state.
- Production `/api/health/deep-check` returned HTTP 200 with 30 passed, 10 warnings, and 0 failures after the auth fix deployment.

Deployment/final verification notes:

- `npm run preflight` passed after the auth/domain/env slice.
- Production Vercel deploy is live on `https://thereach.ten80ten.com`, latest deployment `dpl_FUiurLzeoJvjdQ1ikjov7LEqWNH1`.
- Vercel generated URLs return 401 before the app because the team has SSO deployment protection enabled for non-custom domains, but the custom domain bypasses it and returns HTTP 200.
- Public DNS now resolves `thereach.ten80ten.com` to `51a3fa57b3fdc10d.vercel-dns-016.com.` and `_vercel.ten80ten.com` includes `vc-domain-verify=thereach.ten80ten.com,c53be7e3502e5cb95d54`.
- `vercel inspect thereach.ten80ten.com` resolves to the latest production deployment and lists aliases for `thereach.ten80ten.com`, `the-reach-portal-0utlawstudios-projects.vercel.app`, and `the-reach-portal-git-main-0utlawstudios-projects.vercel.app`.
- `vercel domains inspect thereach.ten80ten.com` still fails with no domain-level access under the CLI account, but this is no longer an app/runtime blocker because the live domain is serving the deployment.
- Production `/api/health/deep-check` returned HTTP 200 with 30 pass, 10 warnings, 0 failures, health score 88/100. The warnings are cloned-data/profile/content warnings, not infrastructure failures.
- `CHANGES-the-reach.md` written with edited vs untouched surfaces and final deployment state.

Auth/domain/env hardening slice notes:

- `.env.local` and `.env.local new for The Reach` both point to Supabase ref `gxmpmdhmxyfqusdzcemt`, carry `SUPABASE_PROJECT_ID=gxmpmdhmxyfqusdzcemt`, `NEXT_PUBLIC_SITE_URL=https://thereach.ten80ten.com`, and `STUDIO_ENABLED=false`.
- Google service account JSON decodes as a valid service-account credential. SMTP host/port/user/pass are set in both Reach env files.
- Vercel project `the-reach-portal` has Production and Development env keys populated from `.env.local`: Supabase, Drive, site URL, health, n8n, SMTP, support, Telegram, `SUPABASE_PROJECT_ID`, and `STUDIO_ENABLED`.
- Vercel Preview env is not populated: the CLI requires a concrete Preview git branch in non-interactive mode, and no separate `VERCEL_TOKEN` is available for direct REST API env creation. Production is the deployment target for `main`.
- Supabase hosted Auth is configured with `site_url=https://thereach.ten80ten.com`, redirect allow-list for the Reach domain/auth routes plus localhost and Vercel fallbacks, signup disabled, SMTP enabled, sender name `The Reach`, Reach invite/recovery subjects, and Reach-logo fallback templates.
- Supabase `password_hibp_enabled` remains false because the hosted project reports the leaked-password protection capability as unavailable on the current tier.
- Hardened `/api/team/resend-invite` to ignore client-supplied role/name, use the persisted pending `team_members` row, normalize email, clean stale `workspace_members`, delete the old auth user, and create a fresh invite user/link.
- Added unit coverage for resend-invite reinvitation hardening.
- Auth emails now use the Reach Sand/Stone wrapper and Reach Sun/Stone CTA styling across invite, reset, support, and admin notifications.
- Auth entry screens use the existing Ten80Ten-style layout with Reach logo and Reach palette controls.
- Local visual QA via Chrome DevTools Protocol passed for desktop login, mobile login, desktop forgot-password, and mobile request-access after restarting the stale local Next server.
- Verification passed: focused resend-invite test, `npm run lint` with the repo's existing two warnings, `npm run typecheck`, full `npm test` with 20 files / 199 tests, and `npm run build`.
- Local `/api/health/deep-check` returned HTTP 200 against new Supabase/Drive/SMTP env during pre-domain QA. After domain verification, production deep health also returns HTTP 200 with zero failures.
- Hosted Supabase SQL verification passed: 33 migrations applied (`0000` through `0032`), baseline workspace `00000000-0000-0000-0000-000000000001` is `The Reach / the-reach`, RLS enabled on `posts`, `media_assets`, `post_comments`, `audit_log_v2`, and `content_plan_rows`, post safety/publisher triggers present, buckets `avatars`, `support-attachments`, and private `ai-assets` present, Realtime enabled for `posts` and `content_plan_rows`, and `aldridge@ten80ten.com` is active `superadmin`.

Creator Studio removal slice notes:

- Removed the Creator Studio page from the app shell and sidebar navigation.
- Removed the Studio page id from navigation state and added a persisted-state guard so stale `"studio"` localStorage values fall back to `dashboard`.
- Removed Settings panels for AI Studio health/access and their calls to `/api/ai/health` and `/api/ai/studio/access`.
- Removed the asset review drawer jump into the Studio row view.
- Deleted the Studio page component, Studio API routes, Studio health/job lookup routes, Studio auth helper, and Studio smoke script.
- Left the AI auto-revise worker/webhook routes in place because they are separate backend automation and preserve existing AI-originated post revision behavior.
- Left migration-backed AI tables/schema intact; no RLS, audit, trigger, publisher lockdown, or pipeline behavior was changed.
- `src/lib/pipeline-context.tsx` has no diff.
- Verification passed: `npm run lint` with the repo's existing two warnings, `npm run typecheck`, `npm test` with 19 files / 197 tests, and `npm run build`.
- Build route table no longer includes `/api/ai/studio/*`, `/api/ai/health`, or `/api/ai/jobs/[id]`.

Supabase slice notes:

- `.env.local` now points to Supabase ref `gxmpmdhmxyfqusdzcemt`, has `SUPABASE_PROJECT_ID=gxmpmdhmxyfqusdzcemt`, has `NEXT_PUBLIC_SITE_URL=https://thereach.ten80ten.com`, and has `STUDIO_ENABLED=false`.
- The valid Google service account JSON was copied from the provided Ten80Ten env into The Reach env files with user approval; SMTP values match the Ten80Ten env byte-for-byte by hash.
- Supabase is linked to the new ref and all 33 migrations `0000` through `0032` are applied.
- Migration ordering fixes were required for a fresh clone: `0002` no longer references enum labels before `0005`, and `0005` now adds the role labels consumed by `0022`.
- Baseline workspace remains `00000000-0000-0000-0000-000000000001` and is labeled `The Reach / the-reach`.
- Buckets verified: `avatars`, `support-attachments`, and private `ai-assets`.
- Realtime verified on `posts` and `content_plan_rows`.
- RLS verified enabled on `posts`, `media_assets`, `post_comments`, `audit_log_v2`, and `content_plan_rows`.
- Post safety/publisher triggers verified: `posts_audit_before_delete`, `posts_protect_approved_and_posted`, `posts_audit_stage_change`, and `posts_block_manual_posted`.
- `aldridge@ten80ten.com` is set as `superadmin` in `team_members`.

Branding/domain/assets slice notes:

- Replaced user-facing product labels with `The Reach` and removed all `Content Engine` user-facing text.
- Replaced logo references with `/the-reach-logo.png`, deleted the obsolete public Ten80Ten logo, regenerated PWA icons and `src/app/favicon.ico` from `The Reach/Favicon.png`, and created a 1200x630 `public/og-image.png` from the supplied Reach logo.
- Updated metadata, manifest, service worker cache namespace, package names, n8n workflow names/files, email from-name, email logo URLs, notification copy, auth screens, post previews, and Brand Kit content.
- Domain fallbacks now use `NEXT_PUBLIC_SITE_URL` with localhost fallback; `.env.local` carries `https://thereach.ten80ten.com`.
- Central palette tokens and manifest theme/background use the documented Reach palette: Sand `#E1DFD5`, Stone `#6C655A`, Sun `#975428`, and Water `#5A656C`.
- Brand Kit defaults use only The Reach source docs: chic/curated/full-service travel, `www.thereach.travel`, bespoke luxury travel planning, design-forward destinations, Bhutan/Switzerland content focuses, and no fabricated phone/email/social handles.
- Verified `rg` old-brand/content search is clean for `src`, `public`, `package*.json`, Supabase config, n8n, and `.github`.
- Verified no old Ten80Ten filenames remain under `src`, `public`, or `n8n`.

Safety notes:

- `src/lib/pipeline-context.tsx` must remain untouched.
- Baseline workspace UUID remains `00000000-0000-0000-0000-000000000001`.
- Do not commit secrets.
- Do not fabricate Supabase refs, Drive IDs, social handles, OpenAI keys, or brand hex values.
