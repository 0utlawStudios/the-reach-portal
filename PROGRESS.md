# The Reach — Drive resumable upload hardening (true root cause)

updated-at: 2026-06-26T15:05:00+08:00

phase: Slices A-E DONE; Slice F (QA swarm + live verification + hardening pass) DONE; AUDIT doc — NEXT

## Root cause (live-proven, do not re-derive)
- `GOOGLE_DRIVE_ROOT_FOLDER_ID=0ADZtEpKEV-CTUk9PVA` is a **Shared Drive** ("The Reach Portal
  Media"); SA `ten80ten-uploader@ten80ten-smm.iam` can add children. SA personal quota
  limit:0 is irrelevant (Shared Drive storage is used).
- A full **93.89 MB video/quicktime resumable upload commits direct-to-Google in 17 s**
  (session 200, 47 chunks, final 200 + fileId; test file trashed). Google/storage/size/chunk
  alignment are NOT the cause.
- Therefore the prod `403 → "Storage rejected the upload."` is a **Vercel-layer mislabel**:
  `sanitizeGoogleDriveError` collapses any unmapped 4xx into `storageRejected`, and the only
  such 403 is the chunk route's `verifyDriveUploadSessionToken()` failure, which had no
  errorReason and was never logged. Fixed: it now returns a truthful `sessionInvalid` 403,
  logged + persisted. Triggers: 60-min TTL expiring mid-stream + fileName/mimeType in the HMAC.

## Live verification (done)
- Direct-to-Google 93.89 MB video/quicktime commit: 17 s (proven, file trashed).
- **Authenticated e2e smoke through the real deployed Vercel routes: PASS (2/2, 1.2m)** —
  `media library upload renders images and video` + `create post upload persists Drive
  metadata without post loss`. Isolated per-run workspace, full teardown. `npm run e2e:prod`.

## QA swarm (3 independent reviewers) — all reported, 0 P0/P1
- Security (LOW risk): 0 P0/P1/P2. 2× P3 — audit persisted pre-redact values; no delete batch cap.
- Correctness: 0 P0/P1. 1× P2 (delete-media 404 → undeletable orphan). 3× P3.
- Completeness/verification: PASS / APPROVE. Gap: no isolated expired-token regression test.

## Slices (each: implement → test → build → commit → push to main)
- [x] A. Truthful error taxonomy: `sessionInvalid` reason; chunk route returns it (logged+alerted).
- [x] B. Session-token robustness: TTL 60min→12h; dropped fragile fileName/mimeType from the HMAC.
- [x] C. 500 MB cap (single constant); chunk rate limit DERIVED from cap (1000/min); proxy zero-byte guard.
- [x] D. upload-audit.ts persists real status/reason + success parity to audit_log_v2.
- [x] E. impersonation no-op documented + safe trash/removePublicPermissions; fail-closed delete-media route.
- [x] F. QA swarm + live e2e + HARDENING PASS (all 6 findings fixed):
  - P2 delete-media 404-orphan: new read-only `getFileMetadataOrNull` (null on confirmed 404)
    → stale row cleaned up instead of permanently undeletable.
  - P3-sec batch cap: `MAX_DELETE_BATCH=25`, overflow returned as explicit `failed` (no silent drop).
  - P3-sec redaction: audit persistence now writes the `normalized` (redacted) values.
  - P3 upload-audit: module-cached admin client + `clearTimeout` in `finally`.
  - P3 read-only folder lookup: new `getSubfolderId` replaces folder-creating `ensureSubfolder` in delete path.
  - Gap: added expired-token regression test (signs past expiry → verify false). 544/544 pass, build OK.
- [ ] AUDIT-thereach-upload.md (read-only adversarial gate, P0-P3, file+line). Final commit = audit + PROGRESS only.

## Deliverables
- PLAN-thereach-upload.md, CHANGES-thereach-upload.md (committed), AUDIT-thereach-upload.md (next).

## Hard invariants
- Posts never disappear; empty DB result is valid; every insert has workspace_id;
  isValidUuid() guards card-ID Supabase ops; no blob: URLs; honest per-file upload status.
- `npm run build` is the load-bearing gate (Next.js route-export checks) before every push.

## last commit SHA
- baseline: 4583762 (before this task); A-E + docs: e3c8b24

## next step
- Commit + push the hardening pass (code + tests + this PROGRESS). Then write AUDIT-thereach-upload.md.
