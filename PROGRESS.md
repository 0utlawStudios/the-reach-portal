# The Reach SMM Portal Progress

updated-at: 2026-06-09T22:56:33+08:00

phase: PHASE 2 - complete; PHG audit pending

current slice:

- Completed Slice 4: multi-select upload surfaces, atomic Media Picker batch callbacks, mixed image/video batch proof, and drawer cover audit honesty fix.
- Completed Slice 3: finalize folder narrowing and tests.
- Completed Slice 2: structured retry classification, app-limiter backoff distinction, sanitized server errors, and proxy/resumable route tests.
- Completed Slice 1: batch isolation contract and Create Post partial-success retention.
- `uploadManyToDrive` now always settles every input file; `stopOnError` is retained only as deprecated compatibility and no longer aborts siblings.
- Create Post stores successful Drive results on each selected file before returning on a partial failure, so a retry uploads only failed files while post creation remains fail-closed.
- Added `.claude/settings.local.json` to `.gitignore`.
- Drive quota 403/429 returns sanitized `driveRateLimited` and retries with jitter.
- App 60/min upload limiter 429 returns sanitized `appRateLimited` and is not retried by the client.
- Proxy, resumable session, and finalize routes now return allowlisted upload error reasons instead of raw Google text.
- Media Picker upload now enables multi-select by default, routes through `uploadManyToDrive`, and delivers successful batch selections atomically to callers that need one state update.
- Asset Review Drawer raw/source upload inputs are multi-select and route through `uploadManyToDrive` with isolated per-file failure reporting.
- Create Post, Media Picker, Asset Review Drawer, and Media Page are guarded by a static test against direct component-level `uploadToDrive` calls.
- Mixed proxy/resumable Vitest now proves small images and large videos can upload together while one large video Drive quota 403 fails without aborting the other files.
- `CHANGES-upload-fix.md` now lists edited files, moved/renamed files, and untouched areas for Phase 2 blast-radius discipline.

current repo:

- `/Users/ace/Documents/CURSOR MAIN/THE REACH SMM PORTAL`
- Package: `the-reach-portal`
- Correct production target: `https://thereach.ten80ten.com`
- Left untouched: `/Users/ace/Documents/CURSOR MAIN/ten80ten-smm-portal`
- Left untouched: in-repo `MAIN/ten80ten-smm-portal`

last commit SHA:

- Last pushed commit before Slice 1: `14ff28d`
- Slice 1 pushed commit: `d384875`
- Slice 2 pushed commit: `fc8779d`
- Slice 3 pushed commit: `2dcd51f`
- Slice 4 pushed commit: `8e3645d`
- CHANGES doc pushed commit: `10d2a18`

investigation summary:

- Confirmed Create Post passes `stopOnError: true` into `uploadManyToDrive`.
- Confirmed `uploadManyToDrive` aborts launching new files after first failure when `stopOnError` is true.
- Reproduced a 30-file batch where one forced failure yields only 3 started results, 2 successes, and 1 failure.
- Confirmed current retry logic treats Drive quota-shaped `429`, `rateLimitExceeded`, and `userRateLimitExceeded` failures as terminal.
- Confirmed `/api/drive/finalize` resolves all three managed folders on every finalize request.
- Confirmed Media Page already uses bounded batch upload.
- Confirmed Media Picker, Asset Review Drawer upload paths, and Create Post license upload still call `uploadToDrive` directly.
- Confirmed `.env.local` contains Google Drive and Supabase keys by name; values were not printed.
- Confirmed `GOOGLE_DRIVE_IMPERSONATE_EMAIL` exists but is not used by `src/lib/google-drive.ts`.

files touched in Phase 1:

- `PLAN-upload-fix.md`
- `PROGRESS.md`

files touched in Slice 1:

- `.gitignore`
- `src/lib/drive-upload.ts`
- `src/lib/create-post-upload-state.ts`
- `src/lib/__tests__/drive-upload.test.ts`
- `src/lib/__tests__/create-post-upload-state.test.ts`
- `src/components/create-post-modal.tsx`
- `PROGRESS.md`

files touched in Slice 2:

- `src/lib/drive-errors.ts`
- `src/lib/drive-upload.ts`
- `src/lib/__tests__/drive-upload.test.ts`
- `src/app/api/drive/proxy-upload/route.ts`
- `src/app/api/drive/proxy-upload/__tests__/route.test.ts`
- `src/app/api/drive/upload/route.ts`
- `src/app/api/drive/upload/__tests__/route.test.ts`
- `src/app/api/drive/finalize/route.ts`
- `PROGRESS.md`

files touched in Slice 3:

- `src/lib/drive-upload.ts`
- `src/app/api/drive/finalize/route.ts`
- `src/app/api/drive/finalize/__tests__/route.test.ts`
- `src/app/api/drive/__tests__/security-static.test.ts`
- `PROGRESS.md`

files touched in Slice 4:

- `src/components/media-picker.tsx`
- `src/components/asset-review-drawer.tsx`
- `src/components/create-post-modal.tsx`
- `src/lib/__tests__/drive-upload.test.ts`
- `src/lib/__tests__/upload-surfaces-static.test.ts`
- `PROGRESS.md`

files touched in CHANGES doc slice:

- `CHANGES-upload-fix.md`
- `PROGRESS.md`

files audited:

- `src/lib/drive-upload.ts`
- `src/lib/google-drive.ts`
- `src/lib/drive-policy.ts`
- `src/lib/upload-alerts.ts`
- `src/lib/media-assets.ts`
- `src/app/api/drive/upload/route.ts`
- `src/app/api/drive/proxy-upload/route.ts`
- `src/app/api/drive/finalize/route.ts`
- `src/app/api/drive/upload-failure/route.ts`
- `src/app/api/drive/stream/route.ts`
- `src/components/create-post-modal.tsx`
- `src/components/pages/media-page.tsx`
- `src/components/media-picker.tsx`
- `src/components/asset-review-drawer.tsx`
- `src/lib/support/use-support.ts`
- `src/app/api/support/uploads/route.ts`
- `src/app/api/admin/backfill-media/route.ts`

evidence captured:

- `tsx` reproduction with real `uploadManyToDrive`: `stopOnError=true results: 3`, `successes: 2`, `failures: 1`; `stopOnError=false results: 30`, `successes: 29`, `failures: 1`.
- `tsx` retry reproduction with real `uploadToDrive`: generic 500 retried and succeeded after 2 sends; 429 and 403 rate-limit-shaped failures stopped after 1 send.
- Official Google Drive docs checked for quota/error handling. Drive can return 403 user-rate-limit and 429 rate-limit responses and recommends jittered exponential backoff. Service-account API calls count as a single account.
- Local Next 16 route handler docs read before planning API route changes: `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` and maxDuration config doc.
- Focused Slice 1 tests: `npm test -- --run src/lib/__tests__/drive-upload.test.ts src/lib/__tests__/create-post-upload-state.test.ts` passed, 2 files / 4 tests.
- `npm run typecheck`: passed.
- `npm run lint`: passed with one pre-existing warning in `src/lib/ai/worker.ts`.
- `npm test`: passed, 38 files / 296 tests.
- `npm run build`: passed.
- Focused Slice 2 tests: `npm test -- --run src/lib/__tests__/drive-upload.test.ts src/app/api/drive/proxy-upload/__tests__/route.test.ts src/app/api/drive/upload/__tests__/route.test.ts` passed, 3 files / 18 tests.
- `npm run typecheck`: passed after Slice 2.
- `npm run lint`: passed after Slice 2 with one pre-existing warning in `src/lib/ai/worker.ts`.
- `npm test`: passed after Slice 2, 38 files / 301 tests.
- `npm run build`: passed after Slice 2.
- Focused Slice 3 tests: `npm test -- --run src/app/api/drive/finalize/__tests__/route.test.ts src/app/api/drive/__tests__/security-static.test.ts` passed, 2 files / 8 tests.
- `npm run typecheck`: passed after Slice 3.
- `npm run lint`: passed after Slice 3 with one pre-existing warning in `src/lib/ai/worker.ts`.
- `npm test`: passed after Slice 3, 39 files / 305 tests.
- `npm run build`: passed after Slice 3.
- Focused Slice 4 tests: `npm test -- --run src/lib/__tests__/drive-upload.test.ts src/lib/__tests__/upload-surfaces-static.test.ts` passed, 2 files / 9 tests.
- `npm run typecheck`: passed after Slice 4.
- `npm run lint`: passed after Slice 4 with one pre-existing warning in `src/lib/ai/worker.ts`.
- `npm test`: passed after Slice 4, 40 files / 308 tests.
- `npm run build`: passed after Slice 4.
- `git diff --check`: passed after Slice 4.
- CHANGES doc slice verification:
  - `npm run typecheck`: passed.
  - `npm test`: passed, 40 files / 308 tests.
  - `npm run lint`: passed with one pre-existing warning in `src/lib/ai/worker.ts`.
  - `npm run build`: passed.
  - `git diff --check`: passed.
  - `npm run verify:target`: passed.

next step:

- Begin the read-only PHG audit and write `AUDIT-upload-hardening.md`.
- Before committing the audit doc, confirm `git diff --stat` shows only `AUDIT-upload-hardening.md`.

blockers:

- None for Phase 1.

hard invariants:

- Posts must never disappear.
- `pipeline-context.tsx` load must call `/api/workspace/provision` before selecting posts.
- Empty DB post results are valid and must not fall back to placeholders.
- Every DB insert must include `workspace_id`.
- Supabase operations on card IDs must guard with `isValidUuid()`.
- No `blob:` URLs may be persisted.
- Upload status must be honest per file.
- Do not edit, import from, or deploy the Ten80Ten SMM portal paths.
