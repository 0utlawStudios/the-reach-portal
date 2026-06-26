# PLAN — The Reach Drive resumable upload: true root cause + fix

/ Status: implemented (commits 4583762..HEAD on main). See CHANGES-thereach-upload.md
for the file ledger and AUDIT-thereach-upload.md for the adversarial pass. /

## Symptom
Client throw `DriveUploadError: "Storage rejected the upload."` on large video uploads
(repro: "Draft The Reach Intro .mov", `video/quicktime`, 93.89 MB, folder `raw-files`,
`creative_director`). Telemetry → `/api/drive/upload-failure`. "Hardened repeatedly,
still failing" because the message lies about which layer failed.

## Investigation (live, against the real service account in `.env.local`)

| Probe | Result | Conclusion |
|---|---|---|
| `drives.get(GOOGLE_DRIVE_ROOT_FOLDER_ID)` | 200, name "The Reach Portal Media" | Root is a **Shared Drive** (`0ADZtEpKEV-CTUk9PVA`) |
| `files.get(root)` | `driveId == id`, `canAddChildren:true` | SA can write to the Shared Drive |
| `about.get` (SA) | `storageQuota.limit = 0` | SA has no personal quota — **irrelevant** for Shared-Drive files |
| Full **93.89 MB** `video/quicktime` resumable upload, direct-to-Google | session 200 → 47 chunks 308 → **final commit 200 + fileId in 17 s** (test file trashed) | **Google + the Shared Drive accept the file. Storage/size/alignment are NOT the cause.** |
| `validUploadUri()` round-trip + HMAC parity on a real session | identical | uploadUri normalization is NOT the cause |
| `.env.local` `GOOGLE_DRIVE_IMPERSONATE_EMAIL` | set, but `getAuth()` never reads it; a `subject` mint fails | broken/unused no-op (latent landmine, not the cause) |

raw-files already holds 7 videos up to 65 MB and media-library a 77 MB video, all via the
resumable path — the path works. The 93.89 MB file is larger than anything previously
stored, which originally looked like a size threshold but is disproven by the 17 s commit.

## Root cause (confirmed)
`sanitizeGoogleDriveError` (`src/lib/drive-errors.ts`) returns the catch-all
`storageRejected` for **any unmapped 4xx**. The **only** chunk-route 403 that has no
`errorReason` and was **never logged** is `verifyDriveUploadSessionToken() === false`
(`src/app/api/drive/upload-chunk/route.ts`), returned as a bare
`{ error: "Upload session does not belong to this workspace" }, 403`. The client's
`errorFromPayload` sanitizes that bare 403 into "Storage rejected the upload." So a
**session/token failure was shown as a storage error**, sending every prior fix to the
wrong layer. Most likely triggers of the verify failure on a large/slow upload: the fixed
**60-minute token TTL** expiring mid-stream, and the HMAC binding `fileName`/`mimeType`
which travel as fragile request headers (a non-ASCII filename mangles → verify fails).

## Fix design (implemented, sliced)
- **A. Truthful taxonomy** — add `sessionInvalid` reason + honest message; the chunk
  route returns it (now **logged + alerted**); the generic `storageRejected` copy is no
  longer a terminal dead-end.
- **B. Token robustness** — TTL 60 min → 12 h (covers a 500 MB upload on a slow uplink);
  drop `fileName`/`mimeType` from the HMAC (they add no security and broke on non-ASCII
  names); keep binding workspace/user/uploadUri/folder/fileSize.
- **C. Cap + rate limit + zero-byte** — one constant `MAX_DRIVE_MEDIA_FILE_SIZE` 250 → 500
  MB; chunk rate limit DERIVED from the cap (`DRIVE_UPLOAD_CHUNK_RATE_LIMIT` = 250×4 =
  1000/min) so a 500 MB upload (250 chunks) can't self-throttle; reject zero-byte in proxy.
- **D. Queryable telemetry** — `src/lib/upload-audit.ts` persists the REAL
  `status=…reason=…` + failing guard to `audit_log_v2`, plus a success parity counter.
- **E. Impersonation + delete-sync** — document the impersonation no-op; add safe
  `trashDriveFile`/`removePublicPermissions` (canTrash, never DELETE); new fail-closed
  `POST /api/drive/delete-media` so deleting media trashes the Drive file instead of
  orphaning it.

## Blast radius
Edited/added (~22 files incl. tests) — justified by the user's explicit "widest scope"
(core 403 + impersonation + delete-sync). UNTOUCHED: auth/login, billing, scheduler,
post-composer, RLS, pipeline-context, the Iron Law post-safety triggers. No new deps.

## Test plan
- Unit: drive-errors taxonomy; session token binding + fail-fast; policy cap + rate-limit
  lockstep; upload-audit persistence (incl. the baseline-UUID guard); google-drive trash
  primitives; delete-media route (7 fail-closed cases).
- Regression: a resumable chunk 403 surfaces as the truthful `sessionInvalid`, never
  "Storage rejected"; hostile inputs (expired/cross-workspace token, zero-byte, oversize,
  misaligned chunk) assert graceful, truthful behavior.
- Gate: `npm run build` (load-bearing) + full `vitest` green before every push.
- Live: direct-to-Google 93.89 MB commit proven (17 s); post-deploy smoke through the
  real Vercel `/api/drive/*` routes for create-post + media-library surfaces.
