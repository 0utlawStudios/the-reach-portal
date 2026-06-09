# The Reach SMM Portal Progress

updated-at: 2026-06-09T23:43:20+08:00

phase: DONE - upload pipeline Preparing stall fix pushed and production-smoked

current slice:

- User reported a live upload remained stuck on `Preparing` while the browser tab kept loading.
- Confirmed a client-side root cause in `src/lib/drive-upload.ts`: Supabase `auth.getSession()` ran before proxy/resumable upload requests with no timeout, so a stalled session read could keep progress at `0%` forever and never open upload requests.
- Confirmed a progress-honesty bug in `uploadManyToDrive`: large batches could have active per-file work greater than zero but round the size-weighted aggregate back to `0%`, keeping the UI label on `Preparing`.
- Fixed both in local commit `9723fc4`: bounded auth preflight with a sanitized non-retryable auth error, reused one testable Supabase client import, emitted started progress before proxy/resumable preflight, clamped nonzero aggregate progress to at least `1%`, and covered proxy image plus resumable video auth stalls in Vitest.
- `npm run verify:target` passed after the local fix; commits `9723fc4` and `7212783` were pushed to `origin/main`.
- Production smoke passed against `https://thereach.ten80ten.com` with a temporary active Supabase user for proxy, resumable session, Google PUT, finalize, and stream range routes.
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
- Progress ledger pushed commit: `3f2215b`
- PHG audit pass 1 pushed commit: `1e789e4`
- Post-audit P1 fix pushed commit: `8621467`
- PHG audit pass 2 pushed commit: `7b2e323`
- Final progress ledger pushed commit: `0fad2b7`
- Field regression fix pushed commit: `9723fc4`
- Preparing stall progress pushed commit: `7212783`

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

files touched in PHG audit pass 1:

- `AUDIT-upload-hardening.md`

files touched in post-audit P1 fix:

- `src/app/api/drive/stream/route.ts`
- `src/app/api/drive/__tests__/security-static.test.ts`
- `src/lib/__tests__/drive-upload.test.ts`
- `PROGRESS.md`

files touched in PHG audit pass 2:

- `AUDIT-upload-hardening.md`
- `PROGRESS.md`

files touched in Preparing preflight stall fix:

- `src/lib/drive-upload.ts`
- `src/lib/__tests__/drive-upload.test.ts`

files touched in Preparing preflight stall ledger update:

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
- PHG audit pass 1 found no P0 and two P1 items:
  - `P1-001`: `/api/drive/stream` returned raw caught exception messages.
  - `P1-002`: hostile 400 / 404 / 415 non-retry proof was missing.
- Focused post-audit P1 tests: `npm test -- --run src/lib/__tests__/drive-upload.test.ts src/app/api/drive/__tests__/security-static.test.ts` passed, 2 files / 13 tests.
- `npm run typecheck`: passed after post-audit P1 fix.
- `npm run lint`: passed after post-audit P1 fix with one pre-existing warning in `src/lib/ai/worker.ts`.
- `npm test`: passed after post-audit P1 fix, 40 files / 310 tests.
- `npm run build`: passed after post-audit P1 fix.
- `git diff --check`: passed after post-audit P1 fix.
- PHG audit pass 2: zero unaddressed P0/P1 findings; remaining items are P2/P3.
- Final focused upload verification: `npm test -- --run src/lib/__tests__/drive-upload.test.ts src/lib/__tests__/upload-surfaces-static.test.ts src/app/api/drive/__tests__/security-static.test.ts src/app/api/drive/finalize/__tests__/route.test.ts src/app/api/drive/upload/__tests__/route.test.ts src/app/api/drive/proxy-upload/__tests__/route.test.ts` passed, 6 files / 31 tests.
- Final `npm run typecheck`: passed.
- Final `npm run lint`: passed with one pre-existing warning in `src/lib/ai/worker.ts`.
- Final `npm test`: passed, 40 files / 310 tests.
- Final `npm run build`: passed.
- Final `git diff --check`: passed.
- Final `npm run verify:target`: passed.
- Production smoke: `GET / -> HTTP 200 in 1.407392s`.
- Production smoke: `POST /api/drive/upload without auth -> HTTP 401 in 5.832716s`.
- Preparing stall focused verification: `npm test -- --run src/lib/__tests__/drive-upload.test.ts` passed, 1 file / 10 tests.
- Preparing stall `npm run typecheck`: passed.
- Preparing stall `npm test`: passed, 40 files / 312 tests.
- Preparing stall `npm run lint`: passed with one pre-existing warning in `src/lib/ai/worker.ts`.
- Preparing stall `npm run build`: passed.
- Preparing stall `git diff --check`: passed.
- Preparing stall `npm run verify:target`: passed with `[verify-the-reach-target] OK: active targets point at thereach.ten80ten.com`.
- Preparing stall production smoke used a temporary active Supabase user and bearer token:
  - `/api/drive/proxy-upload` -> HTTP 200 in 7132ms.
  - `/api/drive/upload` resumable-session creation -> HTTP 200 in 3509ms.
  - Google resumable `PUT` -> HTTP 200 in 4975ms.
  - `/api/drive/finalize` -> HTTP 200 in 6852ms.
  - `/api/drive/stream` range request -> HTTP 206 in 2782ms.
- Preparing stall smoke cleanup:
  - Pre-smoke stale cleanup found `auth_users=0`, `team_members=0`.
  - Temporary `workspace_members`, `team_members`, and auth user rows were deleted.
  - Post-clean verification found `auth_users=0`, `team_members=0` for `codex-smoke+*@ten80ten.com`.
  - Drive cleanup attempted to delete smoke file IDs `16zAiBnn_1hu4CofHgYN-d408A91Yrv1i` and `1u752oBPLKd78jRDqgZObKQ5nQbkQEsJq`; Google returned HTTP 404 through local credentials, so deletion could not be independently confirmed from this workstation.
- `origin/main` and local `HEAD` matched at `7212783beadc3ff4d0d60362a6a48d5c56162689` before this final smoke ledger edit.

next step:

- Commit and push this final smoke ledger, then stop with final report.

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
