# CHANGES — The Reach Drive upload hardening

Range: `4583762..HEAD` on `main` (8 commits). 27 files, +1199/-314.

## Source EDITED (production code)
| File | Change |
|---|---|
| `src/lib/drive-errors.ts` | New `sessionInvalid` reason + `sessionInvalidError()`; honest `storageRejected` copy; `sessionInvalid → 403` in status map. |
| `src/app/api/drive/upload-chunk/route.ts` | Token-verify 403 now returns `sessionInvalid` (logged + alerted, was silent); rate limit uses `DRIVE_UPLOAD_CHUNK_RATE_LIMIT`; verify no longer passes fileName/mimeType. |
| `src/lib/drive-upload-session.ts` | TTL 60 min → 12 h; dropped `fileName`/`mimeType` from the signed HMAC. |
| `src/app/api/drive/upload/route.ts` | Sign call no longer passes fileName/mimeType. |
| `src/lib/drive-policy.ts` | `MAX_DRIVE_MEDIA_FILE_SIZE` 250 → 500 MB; added `DRIVE_BATCH_CONCURRENCY` + derived `DRIVE_UPLOAD_CHUNK_RATE_LIMIT`. |
| `src/app/api/drive/proxy-upload/route.ts` | Reject zero-byte uploads; record success parity event. |
| `src/app/api/drive/finalize/route.ts` | Record success parity event. |
| `src/app/api/drive/upload-alert-scheduler.ts` | Added `scheduleUploadSuccess()`. |
| `src/lib/upload-alerts.ts` | `notifyUploadFailure` persists server-source failures to `audit_log_v2`; returns `persisted`. |
| `src/lib/google-drive.ts` | Documented impersonation no-op; added `trashDriveFile`, `removePublicPermissions`. |
| `src/lib/drive-url-utils.ts` | Added `extractDriveFileIdFromAppUrl`. |
| `src/components/pages/media-page.tsx` | `confirmDeleteSelected` routes through the new delete-media route with fail-closed restore. |

## Source ADDED
| File | Purpose |
|---|---|
| `src/lib/upload-audit.ts` | Queryable upload telemetry (real status/reason + success parity) to `audit_log_v2`. |
| `src/app/api/drive/delete-media/route.ts` | Fail-closed Media Library delete: trash Drive file + strip public access + delete row. |

## Tests ADDED / EDITED
`drive-errors.test.ts` (new), `upload-audit.test.ts` (new), `upload-alerts.test.ts` (new),
`google-drive-delete.test.ts` (new), `delete-media/__tests__/route.test.ts` (new), plus
edits to `drive-upload.test.ts`, `drive-upload-session.test.ts`, `drive-policy.test.ts`,
`upload-chunk/__tests__/route.test.ts`, `proxy-upload/__tests__/route.test.ts`,
`upload/__tests__/route.test.ts`, `upload-surfaces-static.test.ts`. No `.skip()`, no
deleted tests.

## LEFT UNTOUCHED (deliberately)
- Auth/login, session middleware, RLS policies.
- Billing, scheduler, publish jobs, post-composer / create-post pipeline.
- `pipeline-context.tsx` and the Iron Law post-safety triggers (posts never disappear).
- The Ten80Ten SMM portal paths (`ten80ten-smm-portal`, in-repo `MAIN/…`).
- Drive auth/client credentials and env (reused; no new keys requested).

## Follow-up (manual / out of code)
- Remove `GOOGLE_DRIVE_IMPERSONATE_EMAIL` from Vercel + `.env.local` (documented no-op).
- Confirm `DRIVE_UPLOAD_SESSION_SECRET` is set in Vercel (sign fail-fasts in prod if not).
