# Ten80Ten Content Engine

Production portal for The Reach social media operation. The app manages content cards, source media, approvals, media library assets, support, AI revision jobs, and automated publishing.

## Runtime

- Node: use `.nvmrc` (`24`)
- Package manager: npm 11
- Framework: Next.js 16 App Router
- Backend: Supabase, Google Drive, Supabase Storage
- Production host: `https://thereach.ten80ten.com`

Install and run locally:

```bash
nvm use
npm ci
npm run dev
```

Copy `.env.example` to `.env.local` and fill the real values. Never commit real `.env*` files.

## Critical Invariants

- Posts must never disappear after refresh, stage move, failed sync, or automated operation.
- Every domain insert must include `workspace_id`.
- Client Supabase operations using post/card IDs must guard with `isValidUuid()`.
- `pipeline-context.tsx` must provision workspace membership before selecting posts.
- Empty DB results are valid and must not fall back to placeholder cards.
- Media viewing must use same-origin private routes or short-lived signed app URLs, not durable storage links.

Read `AGENTS.md` before changing pipeline, workspace, media, upload, or publishing code.

## Quality Gates

Run before shipping:

```bash
npm run audit
npm run lint
npm run typecheck
npm test
npm run verify:target
npm run build
```

With Supabase CLI credentials available:

```bash
npm run db:types
npm run db:types:check
```

Live media smoke is intentionally guarded because it creates and cleans up QA data:

```bash
PLAYWRIGHT_BASE_URL=https://thereach.ten80ten.com \
QA_ALLOW_PROD_UPLOADS=1 \
npm run e2e:media
```

The media smoke must prove:

- image upload and render
- large-file resumable upload
- HEIC thumbnail render under 10 seconds
- HEIC full lightbox render under 10 seconds
- video playback route works
- Drive and Supabase cleanup completes

## Release Checklist

1. `npm run quality` passes.
2. `npm run verify:target` confirms `thereach.ten80ten.com`.
3. `npm run db:types:check` passes in CI with `SUPABASE_PROJECT_ID` and `SUPABASE_ACCESS_TOKEN`.
4. Production media smoke passes when intentionally enabled.
5. Deep health check is clean enough for release.
6. n8n dry run claims or skips safely.
7. One real scheduled post publish is tested after publisher changes.

## Media And Upload Notes

- Browser-visible Drive media should go through `/api/drive/stream`.
- HEIC/HEIF images should go through `/api/media/image-preview`.
- Optimized videos may use `/api/media/playback`; original Drive upload remains authoritative.
- Copy/open actions must resolve a fresh short-lived view URL.
- Playback-copy upload is best effort. If it times out, the original upload must still succeed.

## n8n Publisher

Workflow export: `n8n/the-reach-auto-publisher-v4.json`.

Required n8n environment:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PUBLISHER_WEBHOOK_HMAC_SECRET`
- `META_PAGE_ACCESS_TOKEN`
- `FACEBOOK_PAGE_ID`
- `INSTAGRAM_BUSINESS_ACCOUNT_ID`
- `LINKEDIN_ACCESS_TOKEN`
- `LINKEDIN_ORG_URN`
- `ALERT_WEBHOOK_URL` optional

The workflow must not contain real secrets or hardcoded Supabase project fallbacks.

## Incident Checks

For upload or media incidents, check in this order:

1. `npm test -- --run src/lib/__tests__/drive-upload.test.ts src/lib/__tests__/media-view-url.test.ts src/lib/__tests__/upload-surfaces-static.test.ts`
2. `/api/health/deep-check` with `Authorization: Bearer HEALTH_CHECK_SECRET`
3. media smoke evidence under Playwright output
4. Drive quota and Google service account access
5. Supabase Storage buckets: `media-playback`, `media-thumbnails`, `support-attachments`
6. upload failure alerts and audit entries

## Secrets

Rotate local secrets if any real `.env*` file is exposed outside the machine. `.env.example` is the only env file intended for source control.
