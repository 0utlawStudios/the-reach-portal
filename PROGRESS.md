# The Reach — Drive resumable upload hardening (true root cause)

updated-at: 2026-06-26T00:00:00+08:00

phase: Slices A+B+C DONE; Slice D (telemetry persistence) — NEXT

## Root cause (live-proven, do not re-derive)
- `GOOGLE_DRIVE_ROOT_FOLDER_ID=0ADZtEpKEV-CTUk9PVA` is a **Shared Drive** ("The Reach Portal
  Media"); SA `ten80ten-uploader@ten80ten-smm.iam` can add children. SA personal quota
  limit:0 is irrelevant (Shared Drive storage is used).
- A full **93.89 MB video/quicktime resumable upload commits direct-to-Google in 17 s**
  (session 200, 47 chunks, final 200 + fileId; test file trashed). Google/storage/size/chunk
  alignment are NOT the cause.
- Therefore the prod `403 → "Storage rejected the upload."` is a **Vercel-layer mislabel**:
  `sanitizeGoogleDriveError` collapses any unmapped 4xx into `storageRejected`, and the only
  such 403 is the chunk route's `verifyDriveUploadSessionToken()` failure
  (`upload-chunk/route.ts:99-109`), which has no errorReason and is never logged.
- Adjacent: zero-byte orphan via proxy (no 0-byte guard); broken/unused
  `GOOGLE_DRIVE_IMPERSONATE_EMAIL`; SA `canDelete=false, canTrash=true` on the Shared Drive.

## Decisions (user-confirmed)
- One enforced cap = **500 MB**. Widest scope: core 403/telemetry + impersonation + delete-sync.
- 500 MB = 250 chunks > the 240/min chunk rate limit → raise the limit in lockstep.

## Slices (each: implement → test → build → commit → push to main)
- [x] A. Truthful error taxonomy: `sessionInvalid` reason; chunk route returns it (logged+alerted); 403 no longer auto-"storageRejected". Tests: drive-errors.test.ts (new), drive-upload.test.ts regression, upload-chunk route.test.ts, upload-surfaces-static.test.ts. 514/514 pass, build OK.
- [x] B. Session-token robustness: TTL 60min→12h (covers 500MB on a slow uplink); dropped fragile fileName/mimeType from the HMAC (non-ASCII filename header mangling can no longer cause a self-inflicted 403); workspace/user/uploadUri/folder/fileSize binding preserved + tested. 515/515 pass, build OK.
- [x] C. 500 MB cap (single constant); chunk rate limit now DERIVED from cap (DRIVE_UPLOAD_CHUNK_RATE_LIMIT=1000/min, was fixed 240 → a 500MB/250-chunk file would self-throttle); proxy zero-byte guard. Lockstep invariants tested. 518/518 pass, build OK.
- [ ] D. Persist real `status=…reason=…` + failing guard to `audit_log_v2`; success counter.
- [ ] E. Remove broken impersonation no-op; switch Shared-Drive deletes to trash.
- [ ] F. AUDIT-thereach-upload.md + CHANGES-thereach-upload.md + final QA swarm.

## Deliverables
- PLAN-thereach-upload.md, CHANGES-thereach-upload.md, AUDIT-thereach-upload.md.

## Hard invariants
- Posts never disappear; empty DB result is valid; every insert has workspace_id;
  isValidUuid() guards card-ID Supabase ops; no blob: URLs; honest per-file upload status.
- `npm run build` is the load-bearing gate (Next.js route-export checks) before every push.

## last commit SHA
- baseline: 4583762 (before this task)

## next step
- Implement Slice A (drive-errors.ts + upload-chunk route + tests).
