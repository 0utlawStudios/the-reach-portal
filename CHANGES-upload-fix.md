# THE REACH Upload Pipeline Changes

updated-at: 2026-06-09T22:54:20+08:00
phase: PHASE 2 change ledger
commits:
- `d384875` Fix upload batch isolation
- `fc8779d` Harden Drive upload retry errors
- `2dcd51f` Narrow Drive finalize folder checks
- `8e3645d` Wire upload surfaces through batch helper

## Edited Files

### Upload Client And Batch Behavior

- `.gitignore`
  - Added `.claude/settings.local.json` so local Claude settings cannot be committed.
- `src/lib/drive-upload.ts`
  - Changed `uploadManyToDrive` to settle every input file with bounded concurrency and no batch abort.
  - Kept `stopOnError` only as deprecated compatibility; it no longer stops sibling uploads.
  - Added structured upload errors, sanitized browser-facing reasons, Drive quota retry classification, jittered backoff, and app-limiter no-retry behavior.
  - Sent the expected Drive folder to `/api/drive/finalize` so finalize verifies only the intended folder.
- `src/lib/drive-errors.ts`
  - Added the allowlisted upload error model used by Drive API routes and the browser client.
- `src/lib/create-post-upload-state.ts`
  - Added helpers that apply successful Create Post uploads to local file state while leaving failed files pending for retry.

### Drive API Routes

- `src/app/api/drive/upload/route.ts`
  - Returned sanitized structured errors for resumable session creation and app rate limiting.
- `src/app/api/drive/proxy-upload/route.ts`
  - Returned sanitized structured errors for proxy uploads and app rate limiting.
- `src/app/api/drive/finalize/route.ts`
  - Required a validated `folder`, resolved only that folder, verified parent membership, then set public permission.

### Upload Surfaces

- `src/components/create-post-modal.tsx`
  - Removed abort-on-first-failure batch behavior.
  - Kept successful uploads attached to modal state after a partial failure so retry uploads only failed files.
  - Kept post creation fail-closed until every selected file has a Drive URL.
  - Routed license upload and Media Picker batch selections through bounded batch upload paths.
- `src/components/media-picker.tsx`
  - Enabled multi-select upload by default.
  - Routed picker upload through `uploadManyToDrive`.
  - Added atomic batch selection delivery with `onSelectMany` so callers can apply successful siblings in one state update.
  - Preserved singleton upload mode for thumbnail picker callers that pass `allowMultipleUpload={false}`.
- `src/components/asset-review-drawer.tsx`
  - Routed cover, raw/source, Media Picker, and license upload paths through `uploadManyToDrive`.
  - Enabled multi-select on raw/source hidden file inputs.
  - Added per-file raw/source failure reporting without discarding successful siblings.
  - Moved cover-replacement audit logging into the success path only.
- `src/components/pages/media-page.tsx`
  - Left behavior unchanged; this page already used `uploadManyToDrive` with multi-select. It is covered by the new static guard.

### Tests

- `src/lib/__tests__/drive-upload.test.ts`
  - Added batch isolation, hostile unsupported input, Drive quota retry, app-limiter no-hammer, and mixed image/video proxy/resumable coverage.
- `src/lib/__tests__/create-post-upload-state.test.ts`
  - Proves partial Create Post successes are retained and failed files stay pending.
- `src/lib/__tests__/upload-surfaces-static.test.ts`
  - Proves named upload surfaces reference `uploadManyToDrive`, do not call `uploadToDrive` directly, and keep batch-accepting inputs multi-select.
- `src/app/api/drive/upload/__tests__/route.test.ts`
  - Covers sanitized app limiter and Google quota failures on resumable session creation.
- `src/app/api/drive/proxy-upload/__tests__/route.test.ts`
  - Covers sanitized app limiter and Google quota failures on proxy upload.
- `src/app/api/drive/finalize/__tests__/route.test.ts`
  - Covers one-folder finalize, wrong-parent rejection, invalid folder rejection, and malformed file ID rejection.
- `src/app/api/drive/__tests__/security-static.test.ts`
  - Guards finalize against reintroducing all-folder derivation.

### Progress And Plan Docs

- `PROGRESS.md`
  - Updated after each slice with phase, commits, touched files, evidence, and next steps.
- `PLAN-upload-fix.md`
  - Created in Phase 1 and left unchanged during Phase 2 execution.

## Moved Or Renamed Files

None.

## Left Untouched

### Auth And Workspace

- Authentication pages and setup routes, except tests already present in the suite.
- `/api/workspace/provision`.
- `pipeline-context.tsx` load/create invariants.
- Workspace membership and RLS policy code.

### Drag And Board Behavior

- Drag/drop implementation.
- Stage movement logic.
- Post delete protections, archive behavior, and pipeline board rendering.

### Notifications

- Notification routes and email templates.
- Mention/published/approval/revision notification behavior.
- Upload failure alert route implementation; only callers now send richer per-file metadata.

### Settings And Profile Uploads

- Settings page avatar upload.
- Auth setup avatar upload.
- User/team settings flows.

### Support Attachments

- Support ticket attachment picker.
- Supabase support upload route.
- Support chat and thread routes.

### Migrations And Database Shape

- No Supabase migrations were changed.
- No RLS policy, trigger, or table definition was changed.
- No DB insert contract was weakened; upload-related inserts continue to pass `workspace_id` where applicable.
