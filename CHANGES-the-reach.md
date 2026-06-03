# The Reach Clone Changes

Latest slice: team request lifecycle hardening is pushed as `fc70b21`. Request-access no longer leaks whether an email is already on the team or already pending, `signup_requests.workspace_id` is now baseline-scoped and `NOT NULL`, admins cannot remove admin-level users, and the last active superadmin cannot be removed. Production audit rows for launch cleanup removals were rechecked and return `SYSTEM`. Verification passed `supabase db push --yes`, focused tests, `git diff --check`, `npm run typecheck`, `npm run lint`, full `npm test`, and `npm run build`.

Latest slice: Drive media access is hardened. Stream fallback is limited to app-known/app-managed Drive files, finalize verifies Drive parent folders before public permissions, and proxy upload rejects files above 4 MB before buffering. Verification passed focused Drive tests, `npm run typecheck`, `git diff --check`, `npm run lint`, full `npm test`, and `npm run build`.

Latest slice: pipeline realtime and notification hardening now drives posts Realtime from resolved workspace state, applies Supabase UPDATE payloads as canonical, rejects revision kickbacks for temporary post IDs, and sends protected notification routes with bearer auth plus response checks. Verification passed focused iron-law tests, `npm run typecheck`, `git diff --check`, `npm run lint`, full `npm test`, and `npm run build`.

Latest slice: audit cleanup actor normalization now resolves known cloned/test launch cleanup removals to `SYSTEM` in both historical detail formats. Verification passed focused setup/static tests, `npm run typecheck`, `git diff --check`, `npm run lint` with only existing warnings, `npm run build`, `supabase db push`, remote migration list `0039`, and production `v_audit_log_with_actor` checks.

## Edited

- Team removal hierarchy: `/api/team/remove-member` now blocks admin-level removal by non-superadmins, prevents deleting the last active superadmin, and preserves the existing stale id/email and self-removal safeguards.
- Request-access anti-enumeration: existing team emails and duplicate pending requests now return a generic received response instead of exposing team/request state to unauthenticated callers.
- Signup request workspace hardening: migration `0040` backfills `signup_requests.workspace_id`, sets the baseline default, enforces `NOT NULL`, and uses a workspace-scoped admin SELECT policy.
- Audit actor verification: production `v_audit_log_with_actor` now returns `SYSTEM` for the launch cleanup member-removal rows shown in the Settings audit screenshot.
- Auth access revalidation: authenticated sessions now re-check team/workspace access on same-user token refresh, focus, visibility recovery, and a 60-second visible-tab interval so revoked/pending users do not keep stale workspace access until manual reload.
- Team/request Realtime invalidation: Settings now subscribes to `team_members` and `signup_requests` changes and reloads through the normal RLS-protected SELECT paths.
- Supabase Realtime access contract: added and applied migration `0037_reach_team_access_realtime.sql`; production now publishes `team_members` and `signup_requests` with full replica identity.
- Access request approval hardening: approval now validates role/email, blocks duplicate team emails, checks orphan Auth/workspace cleanup errors, finalizes the `signup_requests` status before any invite email is sent, and rolls back new Auth/team state if finalization fails.
- Access request rejection hardening: failed reject status updates now return a real error instead of silently succeeding.
- Member removal hardening: workspace/team access revocation remains successful even if Supabase Auth deletion fails after access has already been revoked; the API reports `authCleanupPending` for retry via reinvite cleanup.
- Launch cleanup audit label: the production audit rows for `Reach launch cleanup removed ...` now store `SYSTEM` as actor, and the app also renders those launch cleanup entries as `SYSTEM` defensively.
- Auth/team regression tests: added focused approve-request coverage for ordered approval, rollback on request-finalization failure, invalid role blocking, and reject failure reporting; added remove-member coverage for post-revoke Auth cleanup failure.
- Request-access persistence hardening: `/api/team/request-access` now treats the Supabase insert as authoritative, returns a real error when saving fails, stores the baseline workspace UUID, and no longer shows a fake success when no request row exists.
- Request-access notification hardening: admin email is sent only after a saved row; SMTP failure reports `emailSent: false` without losing the request.
- Team request visibility: Settings now refreshes pending access requests on focus, visibility, and a 60-second visible-tab interval, and explicitly refreshes team/request rows after invite, approve/reject, and resend actions.
- Request-access regression tests: added focused coverage for successful saves, insert failures, existing team conflicts, duplicate pending requests, and SMTP failure after persistence.
- Brand Playbook copy-card elevation: lightened the shared copy-block surface, strengthened Stone borders/shadows, and made the copy icon chip readable so the cards pop from the Sand page background.
- Settings status cleanup: removed the Notion integration card, marked real wired systems as Active/Monitored, and kept Analytics tracking as Coming Soon because no real analytics feature was verified behind that row.
- Brand Playbook card elevation: added a central `reach-copy-card` surface so copy blocks render lighter with stronger Reach Stone borders and more visible elevation in light mode.
- Pipeline drag handle: restored the Ten80Ten card drag contract by moving dnd-kit listeners back to a real visible handle button instead of the whole card/decorative handle pattern.
- Pipeline drag regression coverage: added a static test that locks the drag handle to a real listener button and keeps native image drag disabled on card thumbnails.
- Dashboard fit/density: removed the shared forced-height card wrapper, stopped the summary row from consuming viewport flex height, distributed existing dashboard card content across tall viewports, and corrected the desktop auto-fit scale floor so 1280x720 viewports fit instead of clipping behind the footer.
- Team/invite production cleanup: removed cloned/test non-superadmin users from `team_members`, `workspace_members`, and Supabase Auth so The Reach starts with Aldridge as the only active workspace member.
- Command-button contrast: hardened central Reach action foregrounds, disabled action states, and `bg-primary`/`text-primary-foreground` coverage so primary buttons do not disappear into cream surfaces.
- Primary action wiring: applied the existing Reach action classes to login, forgot-password, reset-password, setup, request-access, create-post, avatar crop, revision, repurpose, support ticket, and support chat command buttons.
- Support Inbox chat access: fixed the server role helper to query `workspace_members.workspace_id` instead of the non-existent `workspace_members.id` column, so superadmins/admins with active workspace access can open and mark support conversations read.
- Support schema test coverage: updated support helper tests to match the real Reach `workspace_members` schema shape.
- Client manual cost comparison: added the zero separate portal subscription positioning and competitor savings math for Later and Hootsuite under "Why this portal beats generic tools for The Reach."
- Manual competitor savings: documented approximate annual savings of `$495`, `$990`, and `$3,564` against relevant paid competitor baselines, with caveats for taxes/add-ons/future pricing changes.
- Button contrast hardening: verified the live Reach site uses Sand `#E1DFD5`, Stone `#6C655A`, and Sun `#975428`, then added central upload/dropzone button rules so labels/icons remain visible before hover.
- Media Library actions: marked upload/select command buttons with `reach-action-button` so Media Library `Upload Files`, mobile upload, and Media Picker `Use This Asset` stay readable in light mode and disabled states.
- Demo health cleanup: added and applied migration `0036_reach_demo_health_cleanup.sql` so seeded demo posts use `Aldridge Dagos` as creator and have no future `created_at` timestamps.
- Deep health pipeline analysis: future-dated idea/revision cards are now reported as planned draft targets instead of warnings, matching the app requirement that demo cards carry schedule fields before approval.
- Invite setup recovery: pending invite users now get a `Complete Setup` action, and `/auth/setup` can resume from an existing Supabase session if the invite token hash was already consumed.
- Invite activation hardening: setup now requires a profile photo before workspace activation; clicking setup without a photo shows `Please add a profile photo.` and the server rejects no-avatar activation.
- Invite recovery guard: users with an already-consumed invite session can still complete setup, but only if they upload a profile photo or already have one stored on their member profile.
- No-photo test users: production is ready for existing no-photo test users to be deleted and reinvited so they pass through the stricter setup flow.
- Media Library usage reconciliation: assets now show as in use when they are referenced by live pipeline card thumbnails or source-vault raw files, even if the persisted `media_assets.used_in` array is empty or stale.
- Media Library filters: `unused` and `in use` now use the reconciled card/media URL map, while ignoring temporary `blob:` preview URLs and deduplicating repeated card references.
- Realtime contract: added migration `0035_reach_realtime_contract.sql` to guarantee `posts` and `content_plan_rows` are in `supabase_realtime` and use `REPLICA IDENTITY FULL`.
- Keep-alive proof: verified the production two-day keep-alive schedule in both Vercel cron and GitHub Actions, and verified the production keep-alive/deep-check endpoints with the configured health secret.
- Drive upload policy: added a shared Drive media policy for valid folders, active-team upload roles, allowed image/video MIME types, MIME normalization, and the 250 MB media size limit.
- Drive resumable upload hardening: `/api/drive/upload` now rejects unsupported MIME types and oversize files before creating Google resumable upload sessions, matching the proxy upload path.
- Drive client upload hardening: `uploadToDrive()` now rejects unsupported/oversize files before starting proxy or direct-to-Google resumable upload work.
- Drawer revision workflow: the inline asset-review drawer revision action now calls the existing `submitKickback()` pipeline contract instead of manually writing notes, moving stage, and firing notification routes separately.
- Revision consistency: drawer revision requests now reuse the pipeline-layer persistence, rollback, audit, mention notification, and revision notification behavior that already protects board drag kickbacks.
- Action-button contrast hardening: strengthened central Reach action/secondary button rules so Review Posts, Invite, Send Invite, Resend, profile save/upload, and other marked command buttons remain readable in light mode, saved design-theme modes, and disabled states.
- Button palette: derived deeper Sun/Stone and Water/Stone action gradients from the approved Reach brand tokens and kept labels/icons on a high-contrast Sand-tinted foreground.
- Action-button readability: added final Reach action classes after the design-mode overrides and applied them to the dashboard Review Posts CTA plus Settings Invite, Send Invite, Approve, Resend, profile save, and profile upload controls.
- Email-change feature: added `POST /api/team/change-email` so active users can safely change their own Supabase Auth email and pending invite emails can be corrected by admins with fresh invite links.
- Email identity reconciliation: the new route updates Supabase Auth, `team_members.email`, support thread reply email, creator display labels where old email was stored, and audit logs together; active self-changes sign out for a fresh Supabase session.
- Team update hardening: removed generic direct `team_members.email` writes from `updateMember`, preventing future Auth/team profile drift.
- Settings Team UI: users can open their own team row to change sign-in email without gaining role-edit access; active non-self email changes are blocked and pending invite changes regenerate invite metadata.
- Profile/role sync hardening: added `POST /api/team/update-member` so Settings profile edits run through server-side reconciliation instead of direct browser writes.
- Workspace role alignment: active member role changes now update both `team_members.role` and `workspace_members.role`, and the route rolls back team edits if workspace/Auth reconciliation fails.
- Auth metadata alignment: profile saves update matching Supabase Auth user metadata for name, phone, avatar, and role so setup, presence, and profile enrichment stay consistent.
- Support access hardening: ticket list/create, live chat read/send, and support upload URL minting now require active workspace membership plus an active team profile instead of falling back to the baseline workspace for any valid Auth session.
- Git/repo binding: reset `origin` to `https://github.com/0utlawStudios/the-reach-portal.git` and pushed `main`.
- Supabase binding: linked the project to ref `gxmpmdhmxyfqusdzcemt`, applied all migrations `0000` through `0032`, kept baseline workspace `00000000-0000-0000-0000-000000000001`, created private `ai-assets`, and enabled Realtime for `posts` and `content_plan_rows`.
- Supabase hosted Auth: set `site_url` and redirect allow-list to `https://thereach.ten80ten.com`, disabled public signup, set SMTP sender name/subjects/templates to The Reach, and kept invite/recovery routes on `/auth/confirm`.
- Vercel: created/linked/deployed project `the-reach-portal`, connected GitHub, populated Production and Development env keys, and deployed production at `https://thereach.ten80ten.com`.
- Domain config: changed app/Supabase/env site URL from the old Reach placeholder to `https://thereach.ten80ten.com`.
- Branding/assets: replaced Ten80Ten user-facing strings/logos with The Reach assets, regenerated icons/favicon/OG image, removed `Content Engine` user-facing copy, and updated manifest/package/n8n/service-worker branding.
- Palette tokens: applied Reach Sand `#E1DFD5`, Stone `#6C655A`, Sun `#975428`, and Water `#5A656C` to central tokens/manifest and auth entry surfaces.
- Creator Studio: removed the Studio navigation/page/settings/API surface and set `STUDIO_ENABLED=false`.
- Auth/login/email: applied The Reach logo/palette to login, forgot-password, reset-password, setup, request-access, and shared email templates.
- Forgot-password recovery bridge: if a copied Reach team member has no Supabase Auth user yet, `/api/auth/forgot-password` now creates or reuses the missing Auth user state and sends a branded setup link instead of silently failing.
- Invite/reinvite hardening: updated `/api/team/resend-invite` to use persisted pending member data, normalize email, clean stale workspace access, delete the old auth user, and generate a fresh invite link. Added unit coverage.
- Superadmin: verified `aldridge@ten80ten.com` is active `superadmin`.

## Untouched

- `src/lib/pipeline-context.tsx` and the post persistence/load behavior.
- Baseline single-tenant workspace UUID.
- RLS design, audit trigger behavior, and `record_audit_event` contract.
- Publisher lockdown trigger `0026`, publish queue contracts, and n8n publisher expectations.
- Auto-revise backend routes and migration-backed AI/publisher tables.
- SMTP credential values, copied from the approved Ten80Ten env source.
- Existing cloned content data, team rows, posts, support schema, and keep-alive/deep-health route behavior.
- Existing authenticated-user reset behavior: known Auth users still receive normal reset-password links.

## Verification

- Auth/team access hardening passed focused auth/team/audit tests with 39 tests, `npm run typecheck`, `git diff --check`, `npm run lint` with only existing warnings, full `npm test` with 28 files / 243 tests, and `npm run build`.
- Production Supabase access verification passed: `team_members` and `signup_requests` are both in `supabase_realtime`; production launch-cleanup audit rows now return `metadata.user_name: SYSTEM`.
- Request-access root fix passed focused team/auth tests, `npm run typecheck`, `npm run lint` with only existing warnings, full `npm test` with 27 files / 237 tests, and `npm run build`; commit `f79b594` was pushed, GitHub CI passed, and Vercel production is ready.
- Production request-access proof passed on `https://thereach.ten80ten.com`: a controlled QA request returned HTTP 200, created one pending `signup_requests` row with the baseline workspace UUID, sent one admin notification, and was then deleted; production pending request count is back to 0 after cleanup.
- Support Inbox production smoke passed on `https://thereach.ten80ten.com`: admin list HTTP 200, thread detail HTTP 200, own support list HTTP 200, own live-chat empty state HTTP 200, self-chat guard HTTP 400, and inactive-recipient guard HTTP 400. Positive admin-to-teammate chat is intentionally blocked until a second user is reinvited and active.
- Brand Playbook copy-card elevation passed `git diff --check`, `npm run typecheck`, `npm run lint` with only existing warnings, and `npm run build`; functional commit `1b57a08` and tracking commit `67cb69d` were pushed to `origin/main`, GitHub CI passed for the latest tree, and production CSS on `https://thereach.ten80ten.com` contains the new raised-card selectors.
- Settings/Brand Playbook UI cleanup passed `git diff --check`, `npm run typecheck`, `npm run lint` with only existing warnings, and `npm run build`; Settings hashtag/caption Manage buttons were verified to already route to the Brand Kit Copy Hub focus targets.
- Settings/Brand Playbook UI cleanup was pushed as `e658660`; GitHub CI passed and Vercel production deployment `dpl_FnJETeprE7sE3U7f72kbmqz8NccL` is ready on `https://thereach.ten80ten.com`.
- Pipeline drag-handle fix verified live data completeness for all Reach demo posts, passed focused iron-law/static tests, `npm run typecheck`, `npm run lint` with only existing warnings, full `npm test` with 26 files / 232 tests, and `npm run build`.
- Pipeline drag-handle fix was pushed as `a17861a`; GitHub CI passed and Vercel production deployment `dpl_5DUQkRveJqhjnFmctSLA7v81eFdd` is ready on `https://thereach.ten80ten.com`.
- Dashboard fit/density slice passed production screenshot inspection before patch, `npm run typecheck`, `npm run lint` with only existing warnings, full `npm test` with 26 files / 232 tests, and `npm run build`.
- Dashboard fit/density final correction was pushed as `5fb733e`; GitHub CI passed and Vercel production deployment `dpl_F9MbsVF19BuF1K8AdVPa8zYnGCZQ` is ready on `https://thereach.ten80ten.com`; live screenshots were captured at `2048x1192` and `1280x720`.
- Team/invite cleanup verified production now has only `aldridge@ten80ten.com` as active `superadmin` with avatar, exactly one active baseline `workspace_members` row, and no Auth users for the removed cloned/test emails.
- Production health after team cleanup passed: keep-alive HTTP 200 and deep-check HTTP 200 with 40 checks, 0 failures, and 0 warnings.
- Command-button contrast slice passed `git diff --check`, `npm run typecheck`, `npm run lint` with only existing warnings, and `npm run build`.
- Command-button contrast slice was pushed as `64dd5b8`; GitHub CI passed and Vercel production deployment `dpl_6rwRBoBCpcyM6bUj2Wg8p9pu7Q3n` is ready on `https://thereach.ten80ten.com`.
- Support Inbox root cause reproduced on production before the fix: thread list returned the Hanes chat, but thread detail and read receipt routes returned `404`; live schema verification confirmed `workspace_members.id` does not exist and `workspace_members.workspace_id` does.
- Support Inbox fix passed focused support helper/API tests, `npm run typecheck`, `npm run lint` with only existing warnings, `npm test` with 26 files / 231 tests, and `npm run build`.
- Support Inbox fix was pushed as `d82c490`; GitHub CI passed and Vercel production deployment `dpl_AFz3i9e4T7TEh55L2ngmLbv88ZMz` is ready on `https://thereach.ten80ten.com`.
- Production support verification passed after deployment for the same Hanes chat thread: thread list HTTP 200 with the target thread, thread detail HTTP 200 with 0 messages, and read receipt HTTP 200.
- Production support chat-flow verification also passed: admin start-chat with Hanes HTTP 200, Hanes load-chat HTTP 200, Hanes send-chat HTTP 200 with message `97d422a2-b3cd-489b-a725-e5dcfe0e2d45`, admin reload saw the message, and admin read HTTP 200.
- Client manual cost/savings update passed HTML structural validation and old-brand/off-brand scan; Later pricing and Hootsuite plans/pricing sources were rechecked before editing.
- Button contrast/demo-health slice passed `npm run typecheck`, `npm run lint` with only existing warnings, `npm test` with 26 files / 231 tests, and `npm run build`.
- Invite setup recovery passed focused auth/setup/provision tests, `npm run typecheck`, `npm run lint`, `npm test` with 26 files / 230 tests, `npm run build`, GitHub CI for SHA `ce84600`, and Vercel production deployment `dpl_6wSf2NKMEJyUQE47kcauTDvpgsUr`.
- Profile-photo setup hardening passed focused auth/setup route tests, `npm run typecheck`, `npm run lint`, `npm test` with 26 files / 231 tests, `npm run build`, GitHub CI for SHA `1748079`, and Vercel production deployment `dpl_CPa3EDKR5EHFLiSa7p4Es1yNk6x1`.
- Media Library usage slice passed `npm run typecheck`, `npm run lint`, `npm test` with 26 files / 228 tests, and `npm run build`.
- Realtime/keep-alive slice applied migration `0035` to Supabase project `gxmpmdhmxyfqusdzcemt`; direct SQL verified `posts` and `content_plan_rows` publication plus full replica identity, keep-alive returned HTTP 200, and deep-check returned HTTP 200 with 0 failures.
- Drive upload policy slice passed focused Drive route tests, `npm run lint`, `npm run typecheck`, `npm test` with 26 files / 228 tests, and `npm run build`.
- Drawer revision slice passed focused iron-law static coverage, `npm run lint`, `npm run typecheck`, `npm test` with 25 files / 225 tests, and `npm run build`.
- Action-button contrast slice passed `npm run lint`, `npm run typecheck`, `npm test` with 25 files / 224 tests, and `npm run build`; generated production CSS contains the strengthened `reach-action-button` and `reach-secondary-action` rules.
- Focused email-change tests passed: active self-change, duplicate rejection, active non-self rejection, pending invite regeneration, and Auth rollback on DB failure.
- Full `npm run preflight` passed after the email-change/action-button slice: 23 test files, 215 tests, lint, typecheck, and production build.
- Focused profile/role tests passed: active role workspace sync, superadmin edit blocking, workspace failure rollback, missing active Auth rejection, and pending invite metadata update.
- Full `npm run preflight` passed after the profile/role sync slice: 24 test files, 220 tests, lint, typecheck, and production build.
- Focused support access tests passed: ticket list/create, chat read/send, and upload URL minting return `403` before write helpers when the Auth user lacks active support access.
- Full `npm run preflight` passed after the support hardening slice: 25 test files, 224 tests, lint, typecheck, and production build.
- `npm run preflight` passed.
- Full test suite passed: 21 files, 202 tests.
- Focused forgot-password tests passed for existing Auth reset, active team-member setup recovery, partial Auth-user retry, and unknown-email anti-enumeration.
- Build passed locally and on Vercel.
- Forgot-password fix deployed to Vercel production `dpl_GgP5iCDvKEyZPKgAg8U36oq9kygb`; production POST `/api/auth/forgot-password` for `aldridge@ten80ten.com` returned success and produced no error-level Vercel logs.
- Supabase Auth now contains the `aldridge@ten80ten.com` user with `superadmin` metadata. Workspace activation is expected after the setup link is opened and `/auth/setup` is completed.
- Hosted Supabase SQL audit passed: 33 migrations, RLS on protected tables, post safety/publisher triggers, buckets, Realtime, baseline workspace, and superadmin.
- Production deep health returned HTTP 200 against new Supabase/Drive/SMTP env: 30 pass, 10 warnings, 0 failures, health score 88/100.
- Local Chrome CDP visual QA passed for desktop/mobile login, forgot-password, and request-access.

## Final Status

- `https://thereach.ten80ten.com` is live and serving the latest Vercel production deployment with the forgot-password recovery bridge.
