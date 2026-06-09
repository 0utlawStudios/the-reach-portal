# THE REACH Upload Hardening Audit

updated-at: 2026-06-09T22:56:33+08:00
phase: PHG audit swarm, pass 1
scope:
- `src/app/api/drive/**`
- `src/lib/drive-*.ts`
- `src/lib/google-drive.ts`
- `src/lib/upload-alerts.ts`
- Drive upload call sites in Create Post, Media Picker, Media Page, and Asset Review Drawer

## Executive Summary

Phase 2 fixes the original production failure mode: batch uploads no longer abort after one file, Drive quota failures retry with jitter, app limiter 429s do not hammer, finalize resolves only the expected folder, and the named upload surfaces route through bounded-concurrency bulk upload.

Audit result: no P0 findings. Two P1 items remain before DONE WHEN can be considered green:
- `P1-001`: `/api/drive/stream` can return raw caught exception messages to the browser.
- `P1-002`: the required hostile proof that 400 / 404 / 415 are not retried is incomplete.

## Findings

### P1-001 - Stream route can leak raw Drive/server exception text to the browser

Evidence:
- `src/app/api/drive/stream/route.ts:223-229` catches any thrown error and returns `{ error: message }` directly to the caller.
- `src/lib/google-drive.ts:216-218` builds thrown metadata errors from raw Drive response text, so a stream metadata failure can include raw Google response bodies in that browser JSON.

Impact:
- This violates the upload-pipeline requirement that browser-facing Drive failures use sanitized allowlisted reasons.
- It is outside the three upload submit routes, but it is still under `src/app/api/drive/**` and is part of the media/Drive pipeline users hit immediately after upload.

Required fix:
- Return a sanitized allowlisted error from the stream route catch path, while preserving raw detail in server logs only.
- Add a route/static test proving raw Google text from a thrown metadata error is not returned.

### P1-002 - Hostile non-retry proof for real 400 / 404 / 415 is incomplete

Evidence:
- `src/lib/drive-errors.ts:101-111` classifies 400, 404, and 415 as non-retryable.
- `src/lib/drive-upload.ts:156-160` honors structured retryability in `withRetry`.
- Current upload helper tests cover Drive quota retry and app limiter no-hammer at `src/lib/__tests__/drive-upload.test.ts:213-273`, but there is no test that forces 400, 404, and 415 and asserts one send each.

Impact:
- The code path appears correct, but the explicit DONE WHEN condition is not fully proven.

Required fix:
- Add a hostile upload-helper test where 400, 404, and 415 fail once and are not retried.
- Keep the existing 403/429 Drive quota retry tests green.

### P2-001 - Service-account quota topology is still single-account

Evidence:
- `src/lib/google-drive.ts:19-24` creates a single service-account `GoogleAuth` client.
- Phase 1 search found `.env.local` contains `GOOGLE_DRIVE_IMPERSONATE_EMAIL`, but the codebase has no `GOOGLE_DRIVE_IMPERSONATE_EMAIL` or `quotaUser` use.

Impact:
- The root Drive call storm was reduced, but all Drive API calls still accrue to one Google service-account quota context. A larger tenant/team burst can still hit Drive per-user quota.

Recommendation:
- Keep current fix as the minimal root-cause release.
- If upload-failure alerts continue to show `userRateLimitExceeded`, plan a separate auth/config slice for domain-wide delegation, impersonation, or quota distribution.

### P2-002 - Media Library upload reports only the first failed file to alerting

Evidence:
- `src/components/pages/media-page.tsx:200-215` sends one `reportUploadFailure` call using the first failed item.
- `src/components/pages/media-page.tsx:220-224` still surfaces every failed file to the user via toasts.

Impact:
- User-facing per-file status is honest, but production observability can undercount multi-file failure clusters on the Media Library page.

Recommendation:
- Send per-file upload failure reports or include all failed file names in one structured alert in a later observability slice.

### P3-001 - Batch helper does not clamp invalid concurrency options

Evidence:
- `src/lib/drive-upload.ts:534` accepts caller-provided `concurrency`.
- `src/lib/drive-upload.ts:574` starts `Math.min(concurrency, total)` workers. A future caller passing `0`, a negative value, or `NaN` can start no workers and return no results.

Impact:
- Current upload surfaces pass `1` or `3`, and `src/lib/__tests__/upload-surfaces-static.test.ts:19-45` guards those surfaces, so this is not a current production blocker.

Recommendation:
- Clamp public helper concurrency to an integer range such as `1..6` in a future robustness cleanup.

## Positive Controls Verified

- Batch isolation: `src/lib/drive-upload.ts:522-575` always returns settled item results, and `src/lib/__tests__/drive-upload.test.ts:173-192` proves 30 inputs with one failure still attempt all 30.
- Mixed media path: `src/lib/__tests__/drive-upload.test.ts:275-313` proves small images use proxy upload while large videos use resumable upload, and one large-video Drive quota 403 does not abort siblings.
- App limiter behavior: `src/lib/__tests__/drive-upload.test.ts:244-273`, `src/app/api/drive/upload/__tests__/route.test.ts:145-164`, and `src/app/api/drive/proxy-upload/__tests__/route.test.ts:126-139` prove app limiter 429s do not retry or hit Drive.
- Finalize folder narrowing: `src/app/api/drive/finalize/route.ts:69-93` validates folder/fileId and resolves one folder, while `src/app/api/drive/finalize/__tests__/route.test.ts:81-125` proves correct and hostile cases.
- Upload surface routing: `src/lib/__tests__/upload-surfaces-static.test.ts:18-45` guards Media Picker, Asset Review Drawer, Create Post, and Media Page against direct component-level `uploadToDrive` calls.
- Create Post partial success retention: `src/components/create-post-modal.tsx:190-227` applies successful uploads before failing closed, with mapping logic in `src/lib/create-post-upload-state.ts:37-92`.

## P0/P1 Fix Plan

1. Fix `P1-001` by sanitizing `/api/drive/stream` catch responses and adding a test.
2. Fix `P1-002` by adding a hostile non-retry test for 400 / 404 / 415.
3. Re-run the full verification suite and `npm run verify:target`.
4. Re-audit once and update this document to pass 2.
