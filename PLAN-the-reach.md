# The Reach Clone Plan

Phase 1 created on 2026-06-03.

## Scope

This is a rebind and rebrand of the duplicated Ten80Ten SMM portal for The Reach. It is not a rebuild.

Authoritative inputs read before planning:

- `AGENTS.md`
- `The Reach/FULL_TECHNICAL_FEATURE_AUDIT.md`
- `The Reach/The Reach.pdf`
- `The Reach/The_Reach_Brand_Guidelines_May_2026_compressed.pdf`
- Local Next 16 docs:
  - `node_modules/next/dist/docs/01-app/01-getting-started/14-metadata-and-og-images.md`
  - `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/01-metadata/manifest.md`
  - `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`
  - `node_modules/next/dist/docs/01-app/02-guides/environment-variables.md`

Hard boundaries:

- Do not touch `src/lib/pipeline-context.tsx`.
- Do not weaken or bypass RLS, audit logs, workspace provisioning, post safety triggers, publish lockdown, or the auto-publisher contract.
- Keep baseline workspace UUID `00000000-0000-0000-0000-000000000001`.
- Do not add dependencies, version bumps, new features, layout rewrites, or broad refactors.
- Do not fabricate Supabase refs/keys, Drive IDs, OpenAI keys, social handles, or brand colors.
- Color changes are central tokens only: `src/app/globals.css`, `public/manifest.json`, and metadata theme values where already present.

## Current State

- Git branch: `main`
- Current origin: `https://github.com/0utlawStudios/T8TSM.git`
- Last commit before Phase 1: `20364e9 chore: stop tracking .omc/ local state in this repo`
- Target origin: `https://github.com/0utlawStudios/the-reach-portal.git`
- GitHub CLI: available and authenticated as `0utlawStudios`.
- Supabase CLI: available, version `2.95.4`.
- Supabase migrations present: 33 files, `0000_baseline.sql` through `0032_trim_team_members_realtime.sql`.
- `supabase/config.toml` currently has `project_id = "ten80ten-smm-portal"`.
- Runtime env files found:
  - `.env.local Ten80Ten`
  - `.env.local new for The Reach`
  - no current `.env.local`

The Reach Supabase project ref discovered from the provided env file:

- `gxmpmdhmxyfqusdzcemt`

Old Ten80Ten Supabase ref to purge from active clone config:

- `lczmgquuzuqhalasjnip`

## Environment Diff Against Audit Section 4

`.env.local new for The Reach` has:

- Supabase: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_ACCESS_TOKEN`
- Google Drive: `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_DRIVE_ROOT_FOLDER_ID`, `GOOGLE_DRIVE_IMPERSONATE_EMAIL`
- SMTP: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`
- Site/health: `NEXT_PUBLIC_SITE_URL`, `HEALTH_CHECK_SECRET`, `N8N_HEALTH_WEBHOOK_URL`
- n8n: `N8N_URL`, `N8N_API_KEY`
- Support alerts: `SUPPORT_NOTIFY_EMAIL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_CHAT_ID`

`.env.local new for The Reach` is missing:

- `SUPABASE_PROJECT_ID`
- `STUDIO_ENABLED`
- `OPENAI_API_KEY`
- `OPENAI_IMAGE_API_KEY`
- `OPENAI_TEXT_MODEL`
- `OPENAI_IMAGE_MODEL`
- `OPENAI_VERIFIER_MODEL`
- `OPENAI_PROMPT_VERSION`
- `CRON_SECRET`
- `AI_WORKER_TRIGGER_SECRET`
- `SUPABASE_WEBHOOK_SECRET`
- `OPENAI_DAILY_CAP_USD`
- `OPENAI_PER_ROW_CAP_USD`
- `NEXT_PUBLIC_OPENAI_DAILY_CAP_USD`
- `OPENAI_PRICE_TEXT_IN`
- `OPENAI_PRICE_TEXT_OUT`
- `OPENAI_PRICE_IMAGE`
- `OPENAI_PRICE_VERIFIER_IN`
- `OPENAI_PRICE_VERIFIER_OUT`

Plan:

- Create ignored `.env.local` from `.env.local new for The Reach`.
- Add `SUPABASE_PROJECT_ID=gxmpmdhmxyfqusdzcemt`.
- Keep `NEXT_PUBLIC_SITE_URL=https://reach.ten80ten.com`.
- Set `STUDIO_ENABLED=false` unless real Creator Studio/OpenAI values are discovered before execution.
- Do not alter `SMTP_*`; the SMTP line hash matches between Ten80Ten and The Reach env files.
- Do not print or commit secrets.

## Brand Token Map

Source: `The Reach/The_Reach_Brand_Guidelines_May_2026_compressed.pdf`.

Color map:

- Sand: `#E1DFD5`, primary background.
- Stone: `#6C655A`, primary text.
- Sun: `#975428`, accent.
- Water: `#5A656C`, secondary accent available from the PDF, not required unless an existing secondary token needs it.

Typography from the PDF:

- Bradford by Lineto: primary brand voice.
- Everett by Weltkern: wordmark and restrained counterpoint.

No local `.woff`, `.woff2`, `.ttf`, or `.otf` font files are present. Implementation will not add a font dependency. CSS may reference the PDF-approved font family names with platform fallbacks, but actual licensed font rendering needs real font assets supplied outside this clone task.

Assets provided:

- `The Reach/The REACH.png`
- `The Reach/Favicon.png`
- `The Reach/The Reach.pdf`
- `The Reach/The_Reach_Brand_Guidelines_May_2026_compressed.pdf`

Logo/icon plan:

- Replace `public/ten80ten-logo.png` references with a The Reach logo asset.
- Update `public/icon-192.png`, `public/icon-512.png`, `public/og-image.png`, and `src/app/favicon.ico` from provided The Reach assets.
- Update `public/manifest.json` name, short name, description, background color, and theme color.
- Update `public/sw.js` cache name and comments.

## Supabase Gaps Against Audit Section 5

Covered by migrations:

- `avatars` bucket is created in `0000_baseline.sql`.
- `support-attachments` bucket is created in `0027_support_center.sql`.
- RLS policies for `posts`, `media_assets`, `post_comments`, `brand_playbook`, and legacy `post_audit_logs` are established in `0007_rls_v2.sql`.
- `audit_log_v2` table/RLS/RPC are established in `0009_audit_log_v2.sql`.
- Post safety triggers are established in `0015_post_safety.sql`.
- Publisher lockdown trigger `posts_block_manual_posted` is established in `0026_publisher_lockdown.sql`.
- Realtime is added for `brand_playbook`, `media_assets`, `support_threads`, and `support_messages`; hardening removes `post_audit_logs` and `team_members`.

Required clone-time actions:

- Link Supabase CLI to `gxmpmdhmxyfqusdzcemt`.
- Push all 33 migrations in order.
- Create private `ai-assets` bucket and policies because no migration exists for it.
- Enable Supabase Realtime publication for `posts`.
- Enable Supabase Realtime publication for `content_plan_rows`.
- Verify baseline workspace row exists.
- Verify RLS is enabled for `posts`, `media_assets`, `post_comments`, and `audit_log_v2`.
- Verify storage buckets exist: `avatars`, `support-attachments`, `ai-assets`.
- Verify `posts_audit_before_delete`, `posts_protect_approved_and_posted`, `posts_audit_stage_change`, and `posts_block_manual_posted` exist.

Creator Studio webhook:

- Current The Reach env has no OpenAI keys and no `SUPABASE_WEBHOOK_SECRET`.
- With `STUDIO_ENABLED=false`, do not configure an active auto-revision webhook.
- If real AI keys and webhook secret are later supplied, configure the full audit Section 4 AI env set before enabling Studio.

## Git Remote Reset Plan

1. Confirm Phase 1 plan commit is local on current origin.
2. Remove old origin: `git remote remove origin`.
3. Create target repo: `gh repo create 0utlawStudios/the-reach-portal --private --source . --remote origin`.
4. Push `main`: `git push -u origin main`.
5. Verify `git remote -v` has no `T8TSM`.

## Runtime Edit Plan

Bounded active surfaces:

- Env/runtime config: ignored `.env.local`, `supabase/config.toml`, `package.json`, `package-lock.json`.
- Public assets/metadata: `public/manifest.json`, `public/sw.js`, `public/ten80ten-logo.png` or renamed replacement, `public/icon-192.png`, `public/icon-512.png`, `public/og-image.png`, `src/app/favicon.ico`, `src/app/layout.tsx`.
- Brand/product strings: current active hits listed below.
- Domain constants: `src/app/layout.tsx`, `src/app/api/drive/stream/route.ts`, `src/app/api/health/deep-check/route.ts`, plus fallback URLs elsewhere.
- Email templates: `src/lib/email-utils.ts`, notification route HTML, team/auth subjects.
- Brand Kit defaults: rebind Ten80Ten remote-talent copy to The Reach travel brand context from the provided brand/business PDFs without adding new UI.
- Creator Studio prompt identity: replace old Ten80Ten agency prompt with The Reach travel brand context.
- n8n JSON: update workflow names, worker id prefix, and old Supabase URL references where safe. Do not commit service-role keys into workflow JSON.

No social handles were provided for The Reach. Do not invent them. Any old Ten80Ten social profile constants must stop exposing Ten80Ten URLs/handles in user-facing UI; use only provided domain data where an existing link is required.

## Active Grep Hit List

Command basis:

`rg -n --hidden -S "Ten80Ten|ten80ten|Content Engine|smm\\.ten80ten\\.com|ten80ten-logo|Ten80Ten-Logo|lczmgquuzuqhalasjnip" src public package.json next.config.ts supabase/config.toml n8n .github --glob '!*.png' --glob '!*.pdf' --glob '!*.ico'`

Exact active file:line hits:

```text
n8n/ten80ten-auto-publisher-v4.json:2
n8n/ten80ten-auto-publisher-v4.json:41
n8n/ten80ten-auto-publisher-v4.json:184
n8n/ten80ten-auto-publisher-v4.json:228
n8n/ten80ten-auto-publisher.json:2
n8n/ten80ten-auto-publisher.json:198
n8n/ten80ten-auto-publisher.json:296
package.json:2
public/manifest.json:2
public/manifest.json:3
public/manifest.json:4
public/sw.js:1
public/sw.js:15
public/sw.js:18
src/app/api/auth/forgot-password/route.ts:63
src/app/api/drive/proxy-upload/route.ts:101
src/app/api/drive/stream/route.ts:10
src/app/api/drive/stream/route.ts:17
src/app/api/health/deep-check/route.ts:257
src/app/api/health/deep-check/route.ts:270
src/app/api/notifications/awaiting-approval/route.ts:17
src/app/api/notifications/awaiting-approval/route.ts:18
src/app/api/notifications/awaiting-approval/route.ts:168
src/app/api/notifications/awaiting-approval/route.ts:202
src/app/api/notifications/awaiting-approval/route.ts:212
src/app/api/notifications/awaiting-approval/route.ts:215
src/app/api/notifications/mention/__tests__/route.test.ts:23
src/app/api/notifications/mention/__tests__/route.test.ts:55
src/app/api/notifications/mention/route.ts:90
src/app/api/notifications/mention/route.ts:116
src/app/api/notifications/revision/route.ts:44
src/app/api/team/approve-request/route.ts:135
src/app/api/team/invite/route.ts:162
src/app/api/team/resend-invite/route.ts:108
src/app/api/workspace/__tests__/provision.test.ts:89
src/app/api/workspace/__tests__/provision.test.ts:103
src/app/api/workspace/__tests__/provision.test.ts:116
src/app/api/workspace/__tests__/provision.test.ts:135
src/app/api/workspace/__tests__/provision.test.ts:155
src/app/api/workspace/__tests__/provision.test.ts:178
src/app/auth/confirm/route.ts:54
src/app/auth/forgot-password/page.tsx:77
src/app/auth/reset-password/page.tsx:115
src/app/auth/setup/page.tsx:206
src/app/auth/setup/page.tsx:209
src/app/auth/setup/page.tsx:303
src/app/layout.tsx:13
src/app/layout.tsx:14
src/app/layout.tsx:15
src/app/layout.tsx:22
src/app/layout.tsx:23
src/app/layout.tsx:24
src/app/layout.tsx:25
src/app/layout.tsx:26
src/app/layout.tsx:32
src/app/request-access/page.tsx:80
src/components/app-shell.tsx:101
src/components/app-shell.tsx:188
src/components/app-shell.tsx:210
src/components/login-screen.tsx:73
src/components/login-screen.tsx:78
src/components/login-screen.tsx:214
src/components/login-screen.tsx:222
src/components/login-screen.tsx:256
src/components/login-screen.tsx:288
src/components/pages/brand-kit-page.tsx:38
src/components/pages/brand-kit-page.tsx:41
src/components/pages/brand-kit-page.tsx:52
src/components/pages/brand-kit-page.tsx:54
src/components/pages/brand-kit-page.tsx:147
src/components/pages/brand-kit-page.tsx:201
src/components/pages/brand-kit-page.tsx:307
src/components/pages/brand-kit-page.tsx:335
src/components/pages/brand-kit-page.tsx:361
src/components/pages/brand-kit-page.tsx:381
src/components/pages/brand-kit-page.tsx:435
src/components/pages/brand-kit-page.tsx:506
src/components/pages/post-preview-page.tsx:16
src/components/pages/post-preview-page.tsx:18
src/components/pages/post-preview-page.tsx:29
src/components/pages/post-preview-page.tsx:41
src/components/pages/post-preview-page.tsx:43
src/components/pages/post-preview-page.tsx:70
src/components/pages/post-preview-page.tsx:72
src/components/pages/post-preview-page.tsx:83
src/components/pages/post-preview-page.tsx:85
src/components/pages/post-preview-page.tsx:110
src/components/pages/settings-page.tsx:791
src/components/pages/settings-page.tsx:1458
src/components/presence-label.tsx:16
src/components/repurpose-modal.tsx:252
src/components/top-bar.tsx:12
src/lib/__tests__/email-utils.test.ts:85
src/lib/__tests__/email-utils.test.ts:104
src/lib/__tests__/email-utils.test.ts:133
src/lib/__tests__/email-utils.test.ts:134
src/lib/__tests__/email-utils.test.ts:139
src/lib/__tests__/email-utils.test.ts:145
src/lib/__tests__/email-utils.test.ts:157
src/lib/__tests__/email-utils.test.ts:158
src/lib/__tests__/rate-limit.test.ts:105
src/lib/ai/prompt-builder.ts:67
src/lib/email-utils.ts:18
src/lib/email-utils.ts:22
src/lib/email-utils.ts:84
src/lib/email-utils.ts:107
src/lib/email-utils.ts:110
src/lib/email-utils.ts:112
src/lib/email-utils.ts:116
src/lib/email-utils.ts:127
src/lib/email-utils.ts:130
src/lib/email-utils.ts:132
src/lib/email-utils.ts:147
src/lib/email-utils.ts:150
src/lib/email-utils.ts:152
src/lib/email-utils.ts:155
src/lib/email-utils.ts:165
src/lib/email-utils.ts:168
src/lib/email-utils.ts:179
src/lib/email-utils.ts:197
src/lib/email-utils.ts:240
src/lib/email-utils.ts:260
src/lib/email-utils.ts:263
src/lib/email-utils.ts:342
src/lib/email-utils.ts:345
src/lib/social-profiles.ts:6
src/lib/social-profiles.ts:8
src/lib/support/__tests__/support-email.test.ts:13
src/lib/support/__tests__/support-email.test.ts:17
src/lib/support/__tests__/support-email.test.ts:28
src/lib/support/__tests__/support-email.test.ts:43
src/lib/support/__tests__/support-email.test.ts:55
src/lib/support/__tests__/support-email.test.ts:67
supabase/config.toml:5
```

Filename hits to handle:

```text
.env.local Ten80Ten
MAIN/ten80ten-smm-portal
Ten80Ten-Logo.png
Ten80Ten_Full_Brand_Guidelines_A4.pdf
docs/TEN80TEN-SMM-CREATOR-STUDIO-MANUAL.html
docs/TEN80TEN-SMM-CREATOR-STUDIO-OPERATOR-MANUAL.md
docs/TEN80TEN-SMM-MANUAL.html
docs/content-calendar/ten80ten-2026-social-calendar
n8n/ten80ten-auto-publisher-v4.json
n8n/ten80ten-auto-publisher.json
public/ten80ten-logo.png
scripts/generate_ten80ten_2026_calendar.py
```

Archived/root docs also contain many historical Ten80Ten references. They are not runtime user-facing app surface. If final repository grep requirements expand beyond `src public`, those docs must be renamed/rewritten or removed as a separate documentation cleanup slice.

## Execution Slices

### Slice 1: Git remote

- Commit this Phase 1 plan.
- Remove T8TSM origin.
- Create and set `0utlawStudios/the-reach-portal`.
- Push `main`.
- QA:
  - Happy: `git remote -v` shows only The Reach repo.
  - Edge 1: `git status --short --branch` is understandable before push.
  - Edge 2: `gh repo view 0utlawStudios/the-reach-portal` succeeds.
  - Edge 3: `git ls-remote --heads origin main` returns main.
  - Hostile: `git remote -v | rg 'T8TSM|ten80ten-smm-portal'` returns no origin hit.

### Slice 2: Supabase/env

- Create ignored `.env.local` for The Reach from provided file.
- Add missing `SUPABASE_PROJECT_ID` and `STUDIO_ENABLED=false` if AI keys remain absent.
- Update `supabase/config.toml` project id to The Reach.
- Link CLI to `gxmpmdhmxyfqusdzcemt`.
- Push all 33 migrations.
- Create private `ai-assets` bucket and policies.
- Enable Realtime for `posts` and `content_plan_rows`.
- Verify tables, baseline workspace, RLS, buckets, triggers, and no schema diff.
- QA:
  - Happy: all 33 migrations applied and `supabase db diff` reports no actionable diff.
  - Edge 1: empty `posts` select remains a valid empty board condition.
  - Edge 2: `posts` and `content_plan_rows` are in `supabase_realtime`.
  - Edge 3: storage has exactly the required clone buckets.
  - Hostile: approved/posted hard-delete trigger remains installed.

### Slice 3: Branding/domain/assets

- Replace product copy so user-facing product reads `The Reach`.
- Replace standalone `Content Engine` user-facing labels with `The Reach`; never emit `The Reach Content Engine`.
- Replace old logo references and generated static assets.
- Replace hardcoded `smm.ten80ten.com` with `reach.ten80ten.com`.
- Update email from-name/logo text and notification CTA labels.
- Update Brand Kit default data from provided The Reach brand/travel docs.
- Update Creator Studio prompt brand identity without changing the hallucination gate or worker contract.
- QA:
  - Happy: auth, app shell, dashboard/nav, Brand Kit, post preview, email HTML, and metadata show The Reach.
  - Edge 1: no `Content Engine` remains in `src public`.
  - Edge 2: no `/ten80ten-logo.png` reference remains in `src public`.
  - Edge 3: no hardcoded `smm.ten80ten.com` remains in active source.
  - Hostile: `pipeline-context.tsx` is untouched.

### Slice 4: Palette

- Change central color tokens only.
- Manifest/background/theme colors use Sand/Sun from PDF.
- Metadata viewport theme colors use the same token values where present.
- QA:
  - Happy: app background/text/accent reflect Sand/Stone/Sun.
  - Edge 1: no broad Tailwind utility replacement.
  - Edge 2: text remains readable on light/dark surfaces.
  - Edge 3: no one-off invented hex values added outside the PDF palette.
  - Hostile: no layout or component restructure.

### Slice 5: Verification/closeout

- Run `npm run preflight`.
- Run health endpoint with `HEALTH_CHECK_SECRET` against new Supabase.
- Confirm final grep:
  - `rg -i "ten80ten|content engine" src public` has no user-facing hit.
  - `rg "lczmgquuzuqhalasjnip|smm\\.ten80ten\\.com" src public n8n supabase/config.toml package.json` has no active hit.
- Write `CHANGES-the-reach.md` with EDITED vs UNTOUCHED.
- Update `PROGRESS.md` after every commit.
- QA:
  - Happy: preflight green.
  - Edge 1: health 200 with secret.
  - Edge 2: origin remains The Reach repo.
  - Edge 3: `.env.local` uses new Supabase ref and required site/project id.
  - Hostile: secrets are not committed or printed.
