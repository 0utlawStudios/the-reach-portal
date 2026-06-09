# THE REACH Upload Hardening Audit

updated-at: 2026-06-09T23:03:03+08:00
phase: PHG audit swarm, pass 2
scope:
- `src/app/api/drive/**`
- `src/lib/drive-*.ts`
- `src/lib/google-drive.ts`
- `src/lib/upload-alerts.ts`
- Drive upload call sites in Create Post, Media Picker, Media Page, and Asset Review Drawer

## Executive Summary

Phase 2 fixes the original production failure mode: batch uploads no longer abort after one file, Drive quota failures retry with jitter, app limiter 429s do not hammer, finalize resolves only the expected folder, and the named upload surfaces route through bounded-concurrency bulk upload.

Audit result after pass 2: no unaddressed P0/P1 findings remain. Pass 1 found two P1 items; both were fixed in `8621467`.

## Findings

### P1-001 - RESOLVED - Stream route can leak raw Drive/server exception text to the browser

Evidence:
- Pass 1: `src/app/api/drive/stream/route.ts:223-229` caught any thrown error and returned `{ error: message }` directly to the caller.
- `src/lib/google-drive.ts:216-218` builds thrown metadata errors from raw Drive response text, so a stream metadata failure can include raw Google response bodies in that browser JSON.
- Fixed: `src/app/api/drive/stream/route.ts:224-230` now returns `sanitizeUnknownUploadError(err)` with `statusForSanitizedDriveError(sanitized)`.
- Guarded: `src/app/api/drive/__tests__/security-static.test.ts:57-60` asserts the stream catch path uses sanitized responses and does not return `JSON.stringify({ error: message })`.

Impact:
- This violates the upload-pipeline requirement that browser-facing Drive failures use sanitized allowlisted reasons.
- It is outside the three upload submit routes, but it is still under `src/app/api/drive/**` and is part of the media/Drive pipeline users hit immediately after upload.

Status:
- Resolved in `8621467`.

### P1-002 - RESOLVED - Hostile non-retry proof for real 400 / 404 / 415 is incomplete

Evidence:
- `src/lib/drive-errors.ts:101-111` classifies 400, 404, and 415 as non-retryable.
- `src/lib/drive-upload.ts:156-160` honors structured retryability in `withRetry`.
- Pass 1: upload helper tests covered Drive quota retry and app limiter no-hammer at `src/lib/__tests__/drive-upload.test.ts:213-273`, but did not force 400, 404, and 415 and assert one send each.
- Fixed: `src/lib/__tests__/drive-upload.test.ts:275-303` now forces 400, 404, and 415 and asserts each file sends once with sanitized non-retryable messages.

Impact:
- The code path appears correct, but the explicit DONE WHEN condition is not fully proven.

Status:
- Resolved in `8621467`.

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

## Pass 2 Verdict

No unaddressed P0/P1 findings remain after re-audit.

Remaining non-blocking items:
- `P2-001`: service-account quota topology is still single-account.
- `P2-002`: Media Library alerting reports only the first failed file.
- `P3-001`: batch helper does not clamp invalid future concurrency options.
