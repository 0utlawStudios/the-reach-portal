# THE REACH Upload Pipeline Root-Cause Plan

updated-at: 2026-06-09T21:40:55+08:00
phase: PHASE 1 - investigate and plan only
production-target: https://thereach.ten80ten.com
repo: /Users/ace/Documents/CURSOR MAIN/THE REACH SMM PORTAL
forbidden-paths:
- /Users/ace/Documents/CURSOR MAIN/ten80ten-smm-portal
- /Users/ace/Documents/CURSOR MAIN/THE REACH SMM PORTAL/MAIN/ten80ten-smm-portal

## Phase Gate

No application code was changed in Phase 1. Phase 2 must not begin until the user gives written approval.

## Audit Map

Drive upload client:
- `src/lib/drive-upload.ts`

Drive API routes:
- `src/app/api/drive/upload/route.ts`
- `src/app/api/drive/proxy-upload/route.ts`
- `src/app/api/drive/finalize/route.ts`
- `src/app/api/drive/upload-failure/route.ts`
- `src/app/api/drive/stream/route.ts`

Drive/server helpers:
- `src/lib/google-drive.ts`
- `src/lib/drive-policy.ts`
- `src/lib/upload-alerts.ts`
- `src/lib/media-assets.ts`

Upload surfaces:
- `src/components/create-post-modal.tsx`
- `src/components/pages/media-page.tsx`
- `src/components/media-picker.tsx`
- `src/components/asset-review-drawer.tsx`

Adjacent non-Drive upload paths audited and left out of the Drive fix:
- `src/lib/support/use-support.ts` and `src/app/api/support/uploads/route.ts`: Supabase signed URL support attachments, not Drive media.
- `src/components/support/attachment-bar.tsx`: local support attachment picker.
- `src/components/kickback-modal.tsx`: local screenshot/reference attachment state.
- `src/components/pages/settings-page.tsx` and `src/app/auth/setup/page.tsx`: profile avatar upload/preview, not Drive media batch pipeline.
- `src/app/api/admin/backfill-media/route.ts`: server backfill of DB media rows, no file upload.

## Reproduction Evidence

Command run with the real `src/lib/drive-upload.ts` module and a mocked `XMLHttpRequest`:

```text
stopOnError=true results: 3
stopOnError=true successes: 2
stopOnError=true failures: 1
stopOnError=true indexes: 0,1,2
xhr sends after aborting run: 3
stopOnError=false results: 30
stopOnError=false successes: 29
stopOnError=false failures: 1
stopOnError=false missing: 0
xhr sends after isolated run: 30
```

This reproduces the VA symptom: one forced failure in a 30-file batch with `stopOnError: true` starts only the first three concurrent workers, producing exactly two successful uploads and one failure instead of uploading the remaining 27 files.

Retry classifier proof with the real `uploadToDrive` and mocked `XMLHttpRequest`:

```text
[drive-upload] Proxy upload attempt 1 failed, retrying in 1000ms...
generic-500 result drive-file-1 sends 2
rate-429 error Google Drive 429 userRateLimitExceeded sends 1
rate-403 error Google Drive 403 rateLimitExceeded sends 1
```

This proves generic 500s retry today, but rate-limit-shaped 429 and 403 Drive failures are treated as terminal after one send.

Environment presence proof, values not printed:

```text
NEXT_PUBLIC_SUPABASE_URL
SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_ACCESS_TOKEN
GOOGLE_SERVICE_ACCOUNT_JSON
GOOGLE_DRIVE_ROOT_FOLDER_ID
GOOGLE_DRIVE_IMPERSONATE_EMAIL
NEXT_PUBLIC_SITE_URL
HEALTH_CHECK_SECRET
N8N_HEALTH_WEBHOOK_URL
SMTP_HOST
SMTP_PORT
SMTP_USER
SMTP_PASS
N8N_URL
N8N_API_KEY
SUPPORT_NOTIFY_EMAIL
TELEGRAM_BOT_TOKEN
TELEGRAM_ADMIN_CHAT_ID
SUPABASE_PROJECT_ID
STUDIO_ENABLED
```

`rg -n "GOOGLE_DRIVE_IMPERSONATE_EMAIL|quotaUser" src scripts` returned no matches. Current Drive calls use the service account credential in `src/lib/google-drive.ts:12-35`; the impersonation env key exists but is unused.

External quota reference checked from official Google docs:
- Google Drive API usage limits: https://developers.google.com/workspace/drive/api/guides/limits
- Google Drive API error handling: https://developers.google.com/workspace/drive/api/guides/handle-errors

Relevant confirmed facts from the official docs: Drive enforces per-minute project and per-minute per-user-per-project quotas; exceeding quotas can return `403: User rate limit exceeded` or `429: Rate limit exceeded`; Google recommends truncated exponential backoff with jitter; service account API calls are considered a single account unless domain-wide delegation/quota user distribution is used.

## Confirmed Root Causes

### RC1 - Create Post aborts the rest of the batch after one per-file failure

Evidence:
- `src/components/create-post-modal.tsx:208-211` passes `stopOnError: true` into `uploadManyToDrive`.
- `src/lib/drive-upload.ts:487-490` keeps an `aborted` flag and worker loop.
- `src/lib/drive-upload.ts:504-510` sets `aborted = true` and returns on the first failed item when `stopOnError` is true.
- `src/lib/drive-upload.ts:514-515` returns only started item results, not one result per input file.

Root-cause fix:
- Remove the aborting semantics from Drive batch uploads. `uploadManyToDrive` must always settle every input file and return exactly one `BatchItemResult` per input index.
- Remove the `stopOnError: true` call from Create Post.
- Preserve fail-closed card creation: if any file fails, Create Post must not create a post with missing files, but the other files must still complete and their statuses must be reported honestly.

### RC2 - Retry logic treats Drive quota failures as permanent

Evidence:
- `src/lib/drive-upload.ts:87-112` implements `withRetry`.
- `src/lib/drive-upload.ts:94-103` treats any message containing `403` or `429` as permanent.
- The reproduction shows `rate-429` and `rate-403` stop after one send while generic `500` retries.
- `src/app/api/drive/proxy-upload/route.ts:131-155` collapses Google Drive upload rejections into a generic client error and does not expose a structured retry reason to the browser.
- `src/lib/google-drive.ts:45-56` has a Drive fetch wrapper, but it does not classify Drive JSON reasons for callers.

Root-cause fix:
- Introduce a structured upload error model in `src/lib/drive-upload.ts` with status, reason, and retryability.
- Parse server JSON error fields and Google-style reason strings instead of scanning raw messages.
- Treat `429`, `rateLimitExceeded`, and `userRateLimitExceeded` as retryable with jittered backoff.
- Keep true client/permanent failures non-retryable: 400, 401, 404, 413, 415, unsupported MIME, empty file, oversize file, invalid folder, invalid fileId.
- Update Drive routes/helpers to return sanitized structured fields for Drive failures where the client needs retry classification.

### RC3 - Resumable finalize re-resolves all managed folders per file

Evidence:
- `src/app/api/drive/finalize/route.ts:70` fetches file metadata.
- `src/app/api/drive/finalize/route.ts:71-73` calls `ensureSubfolder` for every folder in `VALID_DRIVE_FOLDERS` on every finalize request.
- A 30-large-file batch can therefore trigger up to 90 folder-resolution calls in the 90-100% phase, plus metadata and permission calls. `src/lib/google-drive.ts:66-121` has a 5-minute in-process cache, but cold starts and concurrent serverless instances still make this unnecessary work.
- `src/lib/drive-upload.ts:390-397` maps the direct upload to 90% before calling `/api/drive/finalize`, so this extra Drive work is exactly where users observe "stuck at 90%".

Root-cause fix:
- Pass the expected Drive folder from the client to `/api/drive/finalize`.
- Validate the folder against `VALID_DRIVE_FOLDERS`.
- Resolve only that one folder and assert `meta.parents` contains that folder ID before setting public permission.
- Keep the security invariant: finalize must never publicize a file outside app-managed folders.

### RC4 - Some upload surfaces bypass the batch helper

Evidence:
- `src/components/media-picker.tsx:202-218` creates a file input and calls `uploadToDrive` directly.
- `src/components/asset-review-drawer.tsx:292-309` calls `uploadToDrive` for cover replacement.
- `src/components/asset-review-drawer.tsx:362-370` calls `uploadToDrive` for Source Vault raw files.
- `src/components/asset-review-drawer.tsx:823-832` calls `uploadToDrive` for license upload.
- `src/components/create-post-modal.tsx:531-542` calls `uploadToDrive` for license upload.
- `src/components/pages/media-page.tsx:193-198` already uses `uploadManyToDrive` with concurrency 3.

Root-cause fix:
- Route every Drive media upload handler through `uploadManyToDrive`, including one-file semantic uploads via a singleton array.
- Preserve existing visible UI and copy. Any input multiplicity change must be limited to hidden file inputs where the existing operation naturally accepts adding multiple raw/media files.
- Add static tests proving named upload surfaces do not import/call `uploadToDrive` directly and do call `uploadManyToDrive`.

### RC5 - The service-account quota context is real, but not the first minimal fix

Evidence:
- `.env.local` contains `GOOGLE_DRIVE_IMPERSONATE_EMAIL`.
- Code search found no use of `GOOGLE_DRIVE_IMPERSONATE_EMAIL` or `quotaUser`.
- `src/lib/google-drive.ts:19-35` creates a plain `GoogleAuth` client from service-account credentials and scopes.

Root-cause fix decision:
- Do not implement account impersonation in the first fix slice. That is a broader auth/Google Workspace configuration change.
- First remove avoidable call volume, classify quota failures correctly, and isolate per-file failures. If post-audit evidence still shows service-account quota as P0/P1, plan a separate approved slice for domain-wide delegation or `quotaUser` distribution.

## Discarded Or Corrected Leads

- "Proxy buffers the whole file under Vercel and times out" is only true for files under the current proxy threshold. `src/lib/drive-policy.ts:51-52` caps proxy files at 4 MB and `src/lib/drive-upload.ts:416-419` sends larger files through resumable upload. This remains a risk for many small images, but the reproduced two-of-thirty failure is caused by batch abort.
- "Media Page is one-by-one" is not confirmed. `src/components/pages/media-page.tsx:193-198` already uses `uploadManyToDrive` with concurrency 3.
- "Editable Design Link required" is unrelated and must remain untouched per local product memory.

## Phase 2 Slices

### Slice 1 - Batch isolation contract

Files to edit:
- `src/lib/drive-upload.ts`
- `src/components/create-post-modal.tsx`
- new or existing Vitest under `src/lib/__tests__/`

Intent:
- Make `uploadManyToDrive` settle every file and return a complete index-preserving array.
- Remove `stopOnError` usage from Create Post.
- Ensure one forced failure in a 30-file batch still attempts all 30 and reports 29 successes / 1 failure.

Tests:
- Happy: 30 successful files return 30 successes.
- Edge 1: 30 files with item 7 failing returns 29 successes, 1 failure, no missing indexes.
- Edge 2: concurrency cap never exceeds 3 active uploads.
- Edge 3: empty file list returns `[]`.
- Hostile: malformed unsupported file returns a per-file failure and does not prevent valid siblings from uploading.

### Slice 2 - Structured retry classification and jittered backoff

Files to edit:
- `src/lib/drive-upload.ts`
- `src/app/api/drive/proxy-upload/route.ts`
- `src/app/api/drive/upload/route.ts` if needed for structured session errors
- `src/app/api/drive/finalize/route.ts` if needed for structured finalize errors
- Drive route tests and upload helper tests

Intent:
- Replace message substring permanence with structured status/reason classification.
- Retry Drive quota failures: 429, `rateLimitExceeded`, `userRateLimitExceeded`.
- Keep real 400/404/415 non-retryable.
- Add jitter to retry delays so concurrent batch failures do not re-fire in synchronized waves.

Tests:
- Happy: transient 429 then success retries and resolves.
- Edge 1: transient 403 `userRateLimitExceeded` then success retries and resolves.
- Edge 2: generic 500 still retries.
- Edge 3: max retry exhaustion returns a single per-file failure.
- Hostile: 400/404/415 do not retry.

### Slice 3 - Finalize folder narrowing

Files to edit:
- `src/lib/drive-upload.ts`
- `src/app/api/drive/finalize/route.ts`
- `src/app/api/drive/__tests__/security-static.test.ts`
- new or existing route unit test for finalize

Intent:
- Send `{ fileId, folder }` to finalize.
- Validate `folder`.
- Resolve only the requested folder ID and verify the Drive file belongs there before permission changes.
- Preserve the existing malformed fileId guard and MIME/size checks.

Tests:
- Happy: file in requested folder finalizes and sets permission.
- Edge 1: file in another managed folder is rejected.
- Edge 2: invalid folder is rejected before Drive permission.
- Edge 3: malformed fileId is rejected before Drive metadata.
- Hostile: valid-looking file outside app-managed folder is rejected and `setPublicPermission` is not called.

### Slice 4 - Upload surface bulk wiring

Files to edit:
- `src/components/media-picker.tsx`
- `src/components/asset-review-drawer.tsx`
- `src/components/create-post-modal.tsx`
- upload static/behavior tests

Intent:
- Remove direct component-level `uploadToDrive` calls.
- Use `uploadManyToDrive` for Media Picker, Asset Review Drawer cover/raw/license paths, and Create Post license path.
- Keep Media Page on `uploadManyToDrive`.
- Preserve no `blob:` URL persistence and existing per-file failure reporting.

Tests:
- Happy: each named surface statically references `uploadManyToDrive`.
- Edge 1: no named surface directly imports/calls `uploadToDrive`.
- Edge 2: singleton cover/license upload still handles success.
- Edge 3: raw/source upload can settle mixed success/failure without aborting siblings.
- Hostile: unsupported file reports failure and does not update card state with a `blob:` URL.

## PHG Audit Swarm Plan

After Phase 2 is green:
- Write `AUDIT-upload-hardening.md` read-only.
- Audit ingest, concurrency, Drive quota handling, partial-batch integrity, UI honesty at 90%/error, finalize membership checks, retries/backoff, observability, and test-coverage gaps.
- `git diff --stat` must show only `AUDIT-upload-hardening.md`.
- Fix any P0/P1 in new Phase 2-style slices, then re-audit once.

## Verification Plan

For every Phase 2 fix slice before push:
- `npm run typecheck`
- `npm test`
- `npm run lint`
- `npm run build`
- `npm run verify:target`
- focused upload tests for the touched slice
- `git diff --check`

Before every push:
- `npm run verify:target`
- If it fails, stop and report.

Final proof required:
- Focused Vitest showing 30-item batch with one forced Drive 403 still uploads the other 29.
- Grep/static test showing `media-picker.tsx`, `asset-review-drawer.tsx`, `create-post-modal.tsx`, and `media-page.tsx` all route Drive upload paths through `uploadManyToDrive`.
- Retry tests showing 429 / 403 `rateLimitExceeded` retries, while 400 / 404 / 415 do not.
- Finalize test showing only one requested folder is resolved per finalize call.
- Full `typecheck`, `test`, `lint`, `build`, `verify:target`, production smoke, and `git log --oneline`.

## Rollback

Each Phase 2 slice will be committed and pushed separately. Roll back by reverting the specific slice commit:
- Slice 1 rollback restores current abort-on-error behavior.
- Slice 2 rollback restores current retry classifier and server error payloads.
- Slice 3 rollback restores finalize checking all managed folders.
- Slice 4 rollback restores direct single-file upload calls in components.

Rollback caveat: reverting Slice 1 or Slice 2 would reintroduce the observed two-of-thirty failure mode.

## Blast Radius Discipline

Touch only Drive upload client/helper code, Drive API routes required for structured retry/finalize, named upload components, and upload-focused tests/docs.

Leave untouched:
- Auth and workspace provision flow.
- `pipeline-context.tsx` post load/create invariants.
- DB migrations, RLS, and post safety triggers.
- Drag/drop logic.
- Notifications unrelated to upload-failure alerts.
- Settings and profile avatar behavior.
- Support ticket attachment storage.
- Historical docs and the forbidden Ten80Ten SMM portal paths.
