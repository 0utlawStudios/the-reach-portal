# The Reach Clone Changes

## Edited

- Settings status cleanup: removed the Notion integration card, marked real wired systems as Active/Monitored, and kept Analytics tracking as Coming Soon because no real analytics feature was verified behind that row.
- Brand Playbook card elevation: added a central `reach-copy-card` surface so copy blocks render lighter with stronger Reach Stone borders and more visible elevation in light mode.
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

- Settings/Brand Playbook UI cleanup passed `git diff --check`, `npm run typecheck`, `npm run lint` with only existing warnings, and `npm run build`; Settings hashtag/caption Manage buttons were verified to already route to the Brand Kit Copy Hub focus targets.
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
