# The Reach Clone Progress

Phase: Phase 2 slice 4 complete - Creator Studio removed from The Reach portal
Last SHA: 4d1e81d
Next: Push the Creator Studio removal slice, then continue Vercel deployment, final preflight, final deep health check, and `CHANGES-the-reach.md`.
Blockers: Production `https://reach.ten80ten.com` is not reachable yet because the Vercel deployment/domain is not configured. `supabase db diff --linked` could not run because Docker is not running locally. `supabase db push --dry-run --include-all --yes` reports the remote database is up to date.

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

- `.env.local` now points to Supabase ref `gxmpmdhmxyfqusdzcemt`, has `SUPABASE_PROJECT_ID=gxmpmdhmxyfqusdzcemt`, has `NEXT_PUBLIC_SITE_URL=https://reach.ten80ten.com`, and has `STUDIO_ENABLED=false`.
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
- Domain fallbacks now use `NEXT_PUBLIC_SITE_URL` with localhost fallback; `.env.local` carries `https://reach.ten80ten.com`.
- Central palette tokens and manifest theme/background use the documented Reach palette: Sand `#E1DFD5`, Stone `#6C655A`, Sun `#975428`, and Water `#5A656C`.
- Brand Kit defaults use only The Reach source docs: chic/curated/full-service travel, `www.thereach.travel`, bespoke luxury travel planning, design-forward destinations, Bhutan/Switzerland content focuses, and no fabricated phone/email/social handles.
- Verified `rg` old-brand/content search is clean for `src`, `public`, `package*.json`, Supabase config, n8n, and `.github`.
- Verified no old Ten80Ten filenames remain under `src`, `public`, or `n8n`.

Safety notes:

- `src/lib/pipeline-context.tsx` must remain untouched.
- Baseline workspace UUID remains `00000000-0000-0000-0000-000000000001`.
- Do not commit secrets.
- Do not fabricate Supabase refs, Drive IDs, social handles, OpenAI keys, or brand hex values.
