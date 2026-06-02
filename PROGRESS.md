# The Reach Clone Progress

Phase: Phase 2 slice 3 complete - Branding/domain/assets rebind
Last SHA: 8f24919
Next: Commit/push branding slice, write CHANGES-the-reach.md, run final preflight and deep health checks against The Reach env.
Blockers: `supabase db diff --linked` could not run because Docker is not running locally. `supabase db push --dry-run --include-all --yes` reports the remote database is up to date.

Supabase slice notes:

- `.env.local` now points to Supabase ref `gxmpmdhmxyfqusdzcemt`, has `SUPABASE_PROJECT_ID=gxmpmdhmxyfqusdzcemt`, has `NEXT_PUBLIC_SITE_URL=https://reach.ten80ten.com`, and has `STUDIO_ENABLED=false` because real Creator Studio/OpenAI values were not provided.
- SMTP values match the Ten80Ten env byte-for-byte by hash.
- Supabase is linked to the new ref and all 33 migrations `0000` through `0032` are applied.
- Migration ordering fixes were required for a fresh clone: `0002` no longer references enum labels before `0005`, and `0005` now adds the role labels consumed by `0022`.
- Baseline workspace remains `00000000-0000-0000-0000-000000000001` and is labeled `The Reach / the-reach`.
- Buckets verified: `avatars`, `support-attachments`, and private `ai-assets`.
- Realtime verified on `posts` and `content_plan_rows`.
- RLS verified enabled on `posts`, `media_assets`, `post_comments`, `audit_log_v2`, and `content_plan_rows`.
- Post safety/publisher triggers verified: `posts_audit_before_delete`, `posts_protect_approved_and_posted`, `posts_audit_stage_change`, and `posts_block_manual_posted`.

Branding/domain/assets slice notes:

- Replaced user-facing product labels with `The Reach` and removed all `Content Engine` user-facing text.
- Replaced logo references with `/the-reach-logo.png`, deleted the obsolete public Ten80Ten logo, regenerated PWA icons and `src/app/favicon.ico` from `The Reach/Favicon.png`, and created a 1200x630 `public/og-image.png` from the supplied Reach logo.
- Updated metadata, manifest, service worker cache namespace, package names, n8n workflow names/files, email from-name, email logo URLs, notification copy, auth screens, post previews, Brand Kit content, and Creator Studio prompt descriptor.
- Domain fallbacks now use `NEXT_PUBLIC_SITE_URL` with localhost fallback; `.env.local` carries `https://reach.ten80ten.com`.
- Central palette tokens and manifest theme/background use the documented Reach palette: Sand `#E1DFD5`, Stone `#6C655A`, Sun `#975428`, and Water `#5A656C`.
- Brand Kit defaults use only The Reach source docs: chic/curated/full-service travel, `www.thereach.travel`, bespoke luxury travel planning, design-forward destinations, Bhutan/Switzerland content focuses, and no fabricated phone/email/social handles.
- Verified `rg` old-brand/content search is clean for `src`, `public`, `package*.json`, Supabase config, n8n, and `.github`.
- Verified no old Ten80Ten filenames remain under `src`, `public`, or `n8n`.
- `npm run lint` passed with the repo's existing two warnings; `npm run typecheck` passed; `npm test` passed 19 files / 198 tests.
- `src/lib/pipeline-context.tsx` has no diff.

Safety notes:

- `src/lib/pipeline-context.tsx` must remain untouched.
- Baseline workspace UUID remains `00000000-0000-0000-0000-000000000001`.
- Do not commit secrets.
- Do not fabricate Supabase refs, Drive IDs, social handles, OpenAI keys, or brand hex values.
