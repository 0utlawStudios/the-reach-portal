# The Reach SMM Portal Progress

updated-at: 2026-06-09T21:40:55+08:00

phase: PHASE 1 COMPLETE - upload pipeline investigation and plan

current slice:

- Phase 1 only. No runtime application code changed.
- Wrote `PLAN-upload-fix.md`.
- STOP after push and wait for written user approval before Phase 2.

current repo:

- `/Users/ace/Documents/CURSOR MAIN/THE REACH SMM PORTAL`
- Package: `the-reach-portal`
- Correct production target: `https://thereach.ten80ten.com`
- Left untouched: `/Users/ace/Documents/CURSOR MAIN/ten80ten-smm-portal`
- Left untouched: in-repo `MAIN/ten80ten-smm-portal`

last commit SHA:

- Before Phase 1 doc commit: `2f051b4`
- Phase 1 doc commit: pending

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

next step:

- Commit Phase 1 docs.
- Run `npm run verify:target`.
- Push to `origin/main` only if `verify:target` passes.
- Stop and wait for written approval before Phase 2 code.

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
