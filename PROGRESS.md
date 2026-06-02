# The Reach Clone Progress

Phase: IN PROGRESS - production-readiness QA and Reach polish
Last pushed SHA: d2d6d51 support access hardening
Next: Push the Reach light-theme contrast and persisted theme-default slice, then continue Drive/media-library hardening.
Blockers: None. `supabase status`/local DB diff still require Docker if needed.

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
