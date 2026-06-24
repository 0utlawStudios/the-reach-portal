# QA Round 2 Fixes

## Root causes

### Resumable chunk stall retry

The resumable upload stall watchdog aborted the XHR before recording the stall error. In browser and test XHRs, `abort()` can synchronously fire `onabort`, so the chunk retry classifier saw `Upload aborted` instead of the retryable stall error. That skipped the in-place chunk retry and allowed the higher-level upload retry to restart the whole resumable session.

### HEIC fallback pixel safety

The HEIC preview fallback used `heic-convert`, which decodes HEIC pixels and encodes a full JPEG before the route can inspect dimensions. Oversized HEIC inputs could therefore consume decode/encode memory before the existing Sharp pixel guard ran.

## Exact changes

- Changed the upload stall watchdog in `src/lib/drive-upload.ts` to report the stall failure before aborting the XHR transport.
- Added fake-timer coverage proving a stalled resumable chunk retries the same byte range against the same upload session and does not request a fresh session.
- Replaced the preview fallback dependency with direct `heic-decode`.
- The HEIC fallback now calls `decode.all()` first, checks deferred image `width * height` against a 50 MP fallback pixel cap before `image.decode()`, then feeds the decoded RGBA typed array directly into Sharp for resize/JPEG output.
- Decoder resources returned from `decode.all()` are disposed in `finally` on success, over-pixel rejection, and raw conversion failure.
- Replaced the local decoder declaration with `src/types/heic-decode.d.ts`.

## Verification

Focused tests to run:

```bash
npm test -- src/lib/__tests__/drive-upload.test.ts src/app/api/media/image-preview/__tests__/route.test.ts
```

Expected coverage:

- Stalled resumable chunks retry in place without restarting the upload session.
- Normal Sharp HEIC conversion still returns browser-safe JPEG.
- Fallback HEIC conversion uses `heic-decode` raw pixels.
- Over-pixel fallback HEIC files return `413` before raw decode.
- Fallback decoder resources are disposed on success and failure.
