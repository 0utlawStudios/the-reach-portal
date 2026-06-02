# The Reach Clone Changes

## Edited

- Git/repo binding: reset `origin` to `https://github.com/0utlawStudios/the-reach-portal.git` and pushed `main`.
- Supabase binding: linked the project to ref `gxmpmdhmxyfqusdzcemt`, applied all migrations `0000` through `0032`, kept baseline workspace `00000000-0000-0000-0000-000000000001`, created private `ai-assets`, and enabled Realtime for `posts` and `content_plan_rows`.
- Supabase hosted Auth: set `site_url` and redirect allow-list to `https://thereach.ten80ten.com`, disabled public signup, set SMTP sender name/subjects/templates to The Reach, and kept invite/recovery routes on `/auth/confirm`.
- Vercel: created/linked/deployed project `the-reach-portal`, connected GitHub, populated Production and Development env keys, and deployed production at `https://the-reach-portal-9bz0k25l0-0utlawstudios-projects.vercel.app`.
- Domain config: changed app/Supabase/env site URL from the old Reach placeholder to `https://thereach.ten80ten.com`.
- Branding/assets: replaced Ten80Ten user-facing strings/logos with The Reach assets, regenerated icons/favicon/OG image, removed `Content Engine` user-facing copy, and updated manifest/package/n8n/service-worker branding.
- Palette tokens: applied Reach Sand `#E1DFD5`, Stone `#6C655A`, Sun `#975428`, and Water `#5A656C` to central tokens/manifest and auth entry surfaces.
- Creator Studio: removed the Studio navigation/page/settings/API surface and set `STUDIO_ENABLED=false`.
- Auth/login/email: applied The Reach logo/palette to login, forgot-password, reset-password, setup, request-access, and shared email templates.
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

## Verification

- `npm run preflight` passed.
- Full test suite passed: 20 files, 199 tests.
- Build passed locally and on Vercel.
- Hosted Supabase SQL audit passed: 33 migrations, RLS on protected tables, post safety/publisher triggers, buckets, Realtime, baseline workspace, and superadmin.
- Local deep health returned HTTP 200 against new Supabase/Drive/SMTP env.
- Local Chrome CDP visual QA passed for desktop/mobile login, forgot-password, and request-access.

## Remaining Blocker

- `thereach.ten80ten.com` has public DNS records in place, but Vercel still reports `domain_not_owned` / no access under `0utlawstudios-projects`. The Vercel-generated URLs are protected by team SSO, and project protection is set to `all_except_custom_domains`, so public access depends on completing custom-domain ownership in Vercel.
