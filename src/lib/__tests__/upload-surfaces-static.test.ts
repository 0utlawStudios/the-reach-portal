import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function source(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf8");
}

const uploadSurfaces = [
  "src/components/media-picker.tsx",
  "src/components/asset-review-drawer.tsx",
  "src/components/create-post-modal.tsx",
  "src/components/pages/media-page.tsx",
];

describe("Drive upload surfaces", () => {
  it("route named upload surfaces through bounded batch upload, not direct single-file upload", () => {
    for (const file of uploadSurfaces) {
      const contents = source(file);
      expect(contents, file).toContain("uploadManyToDrive");
      expect(contents, file).not.toMatch(/\buploadToDrive\b/);
    }
  });

  it("keeps user-facing media upload inputs multi-select where the operation accepts batches", () => {
    const mediaPicker = source("src/components/media-picker.tsx");
    expect(mediaPicker).toContain("input.multiple = allowMultipleUpload");
    expect(mediaPicker).toContain("allowMultipleUpload = true");
    expect(mediaPicker).toContain("onSelectMany");

    const drawer = source("src/components/asset-review-drawer.tsx");
    expect(drawer).toContain('uploadManyToDrive(selectedFiles, "raw-files"');
    expect(drawer.match(/ref=\{rawFileInputRef\} type="file" multiple/g) || []).toHaveLength(2);
    expect(drawer).toContain("onSelectMany={applyMediaPickerSelections}");

    const createPost = source("src/components/create-post-modal.tsx");
    expect(createPost).toContain('ref={fileInputRef} type="file" multiple accept="image/*,video/*,.heic,.heif"');
    expect(createPost).toContain("onSelectMany={addMediaPickerSelections}");

    const mediaPage = source("src/components/pages/media-page.tsx");
    expect(mediaPage).toContain('ref={fileInputRef} type="file" multiple accept="image/*,video/*,.heic,.heif"');
    expect(mediaPage).toContain('uploadManyToDrive(fileList, "media-library"');
  });

  it("keeps Create New Post lightweight for Ideas drafts", () => {
    const createPost = source("src/components/create-post-modal.tsx");
    const submitValidation = createPost.slice(
      createPost.indexOf("const handleSubmit"),
      createPost.indexOf("setSubmitting(true);"),
    );
    expect(submitValidation).toContain('if (!title.trim()) missing.push("title")');
    expect(submitValidation).not.toContain("files.length === 0");
    expect(submitValidation).not.toContain("platforms.length === 0");
    expect(submitValidation).not.toContain("!scheduledDate");
    expect(submitValidation).not.toContain("!scheduledTime");
    expect(submitValidation).not.toContain("!caption.trim()");
    expect(submitValidation).not.toContain("!assetSource.trim()");
    expect(createPost).toContain('submitting ? "Uploading..." : "Create Idea"');
  });

  // Regression guard for the "stuck on Preparing…" production incident: an
  // upload handler whose dynamic import (or any pre-send await) threw — e.g. a
  // stale code-split chunk after a deploy — left `uploading`/`submitting` true
  // and progress at 0 forever, with no error. Every surface must reset its
  // loading state on EVERY exit path (finally for the page/picker/drawer; a
  // fail-closed flag that routes back to setSubmitting(false) for create-post).
  it("never strands the upload UI on a failed or aborted upload", () => {
    // media-page, media-picker and the drawer reset uploading state in finally.
    for (const file of [
      "src/components/pages/media-page.tsx",
      "src/components/media-picker.tsx",
      "src/components/asset-review-drawer.tsx",
    ]) {
      const contents = source(file);
      expect(contents, `${file} must reset uploading state in a finally`).toMatch(
        /finally \{[\s\S]*?setUploading\(false\)/,
      );
    }

    // The drawer has two upload handlers; both need their own finally.
    const drawer = source("src/components/asset-review-drawer.tsx");
    expect((drawer.match(/\} finally \{/g) || []).length).toBeGreaterThanOrEqual(2);

    // create-post is fail-closed: an upload throw marks uploadFailed, which the
    // guard below resets submitting on, instead of rejecting the handler.
    const createPost = source("src/components/create-post-modal.tsx");
    expect(createPost).toContain("Couldn't upload your files");
    expect(createPost).toMatch(/if \(uploadFailed\) \{[\s\S]*?setSubmitting\(false\)/);

    // Upload-adjacent surfaces hardened in the follow-up sweep (kickback
    // attachment upload, profile avatar upload) must reset their loading flag in
    // a finally, not only on the happy path.
    const kickback = source("src/components/kickback-modal.tsx");
    expect(kickback).toMatch(/finally \{[\s\S]*?setUploading\(false\)/);
    const settingsPage = source("src/components/pages/settings-page.tsx");
    expect(settingsPage).toMatch(/finally \{\s*setUploading\(false\)/);

    // A catch block that re-imports the drive-upload chunk would re-throw on the
    // very stale chunk that broke the upload, swallowing the error toast and
    // (where cleanup is outside the catch) stranding the UI. Telemetry in catch
    // must use the guarded `driveModule?.` handle instead of a second import.
    // Line-based check: every drive-upload import must follow a `try` opener,
    // never a `catch` opener.
    for (const file of uploadSurfaces) {
      const lines = source(file).split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (!/await import\("@\/lib\/drive-upload"\)/.test(lines[i])) continue;
        let j = i - 1;
        while (j >= 0 && lines[j].trim() === "") j--;
        const prev = j >= 0 ? lines[j].trim() : "";
        expect(
          /catch\s*\(/.test(prev),
          `${file}:${i + 1} re-imports drive-upload directly inside a catch`,
        ).toBe(false);
      }
    }
  });

  it("bounds the initial auth session check so the app cannot hang forever on Checking session", () => {
    const authContext = source("src/lib/auth-context.tsx");
    expect(authContext).toContain("AUTH_SESSION_TIMEOUT_MS");
    expect(authContext).toContain('withAuthSessionTimeout(supabase.auth.getSession(), "Session check")');
    expect(authContext).toContain("setHydrated(true)");
  });

  it("renders preview-safe media URLs without changing publish-safe raw URLs", () => {
    const mediaPicker = source("src/components/media-picker.tsx");
    expect(mediaPicker).toContain('function mediaDisplayUrl(asset: Pick<MediaEntry, "url" | "driveProxyUrl" | "playbackUrl">): string');
    expect(mediaPicker).toContain("return stripPrivateMediaToken(asset.playbackUrl || asset.driveProxyUrl || asset.url)");
    expect(mediaPicker).toContain("mediaAssetId: asset.assetId");
    expect(mediaPicker).toContain("mediaVideoSources(asset, true)");
    expect(mediaPicker).toContain('preload="metadata"');
    expect(mediaPicker).toContain('controls');

    const mediaPage = source("src/components/pages/media-page.tsx");
    expect(mediaPage).toContain("getAutomaticMediaUsage(asset, cards)");
    expect(mediaPage).toContain("syncedUsedInValue(asset.usedIn, usage?.automaticCards || [])");
    expect(mediaPage).toContain("MEDIA_MANUAL_USED_TAG");
    expect(mediaPage).toContain("toggleManualUsed");
    expect(mediaPage).toContain('label={`${lightboxAsset.name} video preview`}');
    // Grid/list video cells render Drive's cached poster frame (an image) instead of a live
    // video element that re-fetches every refresh; the live player stays in the lightbox.
    expect(mediaPage).toContain("videoPosterUrl(asset)");
    expect(mediaPage).toContain('fallbackIcon="video"');
    expect(mediaPage).toContain('className="max-w-full max-h-[60vh] object-contain rounded-lg bg-black"');
    expect(mediaPage).toContain('className="w-full h-[60vh] max-w-full max-h-[60vh] object-contain rounded-lg select-none"');

    const drawer = source("src/components/asset-review-drawer.tsx");
    expect(drawer).toContain("const displayUrl = file.playbackUrl || file.driveProxyUrl || file.url");
    expect(drawer).toContain("browserImagePreviewUrl(file.driveProxyUrl || file.url");
    expect(drawer).toContain("openViewableUrl");
    expect(drawer).toContain("resolveViewableMediaUrl(url)");
    expect(drawer).toContain("onClick={() => void openViewableUrl(openUrl, file.name)}");
  });

  it("bounds direct Supabase Storage uploads outside the Drive media path", () => {
    for (const file of [
      "src/components/pages/settings-page.tsx",
      "src/app/auth/setup/page.tsx",
      "src/components/kickback-modal.tsx",
      "src/lib/ai/upload.ts",
    ]) {
      const contents = source(file);
      expect(contents, `${file} must import the shared storage upload timeout`).toContain("withStorageUploadTimeout");
      expect(contents, `${file} must not call storage upload without the timeout wrapper nearby`).toMatch(
        /withStorageUploadTimeout\([\s\S]*?(?:uploadToSignedUrl|\.upload)\(/,
      );
    }

    const setup = source("src/app/auth/setup/page.tsx");
    expect(setup).toMatch(/catch \(err\) \{[\s\S]*?setLoading\(false\)/);

    const support = source("src/lib/support/use-support.ts");
    expect(support).toContain("storageUploadBudgetMs");
    expect(support).toContain("SUPPORT_UPLOAD_STALL_TIMEOUT_MS");
    expect(support).toContain("SUPPORT_UPLOAD_RESPONSE_WAIT_MS");
    expect(support).toContain("new XMLHttpRequest()");
    expect(support).toContain("xhr.upload.onprogress");
    expect(support).toContain('xhr.open("PUT", supportSignedUploadUrl');
  });

  it("keeps Drive video uploads when optional playback optimization fails", () => {
    const createPost = source("src/components/create-post-modal.tsx");
    expect(createPost).toContain("const playbackOptimizations");
    expect(createPost).toContain('phase: "create_post_playback_upload"');
    expect(createPost).toContain("Uploaded ${rawFile.name}, but fast video playback was skipped.");
    expect(createPost).toContain("Promise.allSettled(playbackOptimizations.map((run) => run()))");
    expect(createPost).not.toContain("Retry this upload before creating the post.");

    const mediaPicker = source("src/components/media-picker.tsx");
    expect(mediaPicker).toContain("const playbackOptimizations");
    expect(mediaPicker).toContain('phase: "media_picker_playback_upload"');
    expect(mediaPicker).toContain("Uploaded ${item.file.name}, but fast video playback was skipped.");
    expect(mediaPicker).toContain("Promise.allSettled(playbackOptimizations.map((run) => run()))");
    expect(mediaPicker).not.toContain("Playback optimization failed for ${item.file.name}");

    const drawer = source("src/components/asset-review-drawer.tsx");
    expect(drawer).toContain("const playbackOptimizations");
    expect(drawer).toContain('phase: "drawer_playback_upload"');
    expect(drawer).toContain("Uploaded ${file.name}, but fast video playback was skipped.");
    expect(drawer).toContain("Promise.allSettled(playbackOptimizations.map((run) => run()))");
    expect(drawer).not.toContain("Playback optimization failed for ${file.name}");

    const mediaPage = source("src/components/pages/media-page.tsx");
    expect(mediaPage).toContain("const playbackOptimizations");
    expect(mediaPage).toContain('phase: "media_library_playback_upload"');
    expect(mediaPage).toContain("Uploaded ${file.name}, but fast video playback was skipped.");
    expect(mediaPage).toContain("playbackStorageKey: playback.playbackStorageKey");
    expect(mediaPage).toContain("Promise.allSettled(playbackOptimizations.map((run) => run()))");
  });

  it("keeps optimized playback copies behind the app workspace gate, not public storage URLs", () => {
    const playbackUploadRoute = source("src/app/api/media/playback-upload/route.ts");
    expect(playbackUploadRoute).toContain("public: false");
    expect(playbackUploadRoute).not.toContain("getPublicUrl");
    expect(playbackUploadRoute).toContain('const playbackUrl = `/api/media/playback?key=${encodeURIComponent(storageKey)}`');
    expect(playbackUploadRoute).toContain("scheduleUploadFailureAlert");
    expect(playbackUploadRoute).toContain('phase: "playback_upload_target"');

    const playbackRoute = source("src/app/api/media/playback/route.ts");
    expect(playbackRoute).toContain("requireUser(request)");
    expect(playbackRoute).toContain("userCanReadPlaybackWorkspace");
    expect(playbackRoute).toContain('.eq("workspace_id", workspaceId)');
    expect(playbackRoute).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(playbackRoute).toContain("streamWithInactivityTimeout");

    const privateBucketsMigration = source("supabase/migrations/0051_private_media_derivative_buckets.sql");
    expect(privateBucketsMigration).toContain("set public = false");
    expect(privateBucketsMigration).toContain("drop policy if exists \"Public read media-playback\"");
    expect(privateBucketsMigration).toContain("drop policy if exists \"Public read media-thumbnails\"");

    const mediaPlayback = source("src/lib/media-playback.ts");
    expect(mediaPlayback).toContain("playbackUrl: string");
    expect(mediaPlayback).not.toContain("publicUrl");
  });

  it("bounds storage and support control-plane requests that gate media work", () => {
    const support = source("src/lib/support/use-support.ts");
    expect(support).toContain("SUPPORT_API_TIMEOUT_MS");
    expect(support).toContain("new AbortController()");
    expect(support).toContain("Support request timed out");

    for (const file of [
      "src/components/pages/settings-page.tsx",
      "src/components/kickback-modal.tsx",
      "src/lib/ai/upload.ts",
      "src/lib/support/server.ts",
      "src/app/api/media/image-preview/route.ts",
      "src/app/api/media/playback-upload/route.ts",
    ]) {
      const contents = source(file);
      expect(contents, `${file} must import the shared storage control timeout`).toContain("withStorageControlTimeout");
    }

    const drive = source("src/lib/google-drive.ts");
    expect(drive).toContain("ACCESS_TOKEN_MINT_TIMEOUT_MS");
    expect(drive).toContain("cachedAccessToken");
    expect(drive).toContain("Google Drive token mint timed out");

    const upload = source("src/lib/drive-upload.ts");
    expect(upload).toContain("UPLOAD_FAILURE_REPORT_TIMEOUT_MS");
    expect(upload).toContain('fetch("/api/drive/upload-failure"');
    expect(upload).toContain("signal: controller.signal");

    const driveStreamRoute = source("src/app/api/drive/stream/route.ts");
    expect(driveStreamRoute).toContain("streamWithInactivityTimeout");
    expect(driveStreamRoute).toContain("Google Drive media stream");

    const playbackRoute = source("src/app/api/media/playback/route.ts");
    expect(playbackRoute).toContain("streamWithInactivityTimeout");
    expect(playbackRoute).toContain("Supabase playback media stream");
  });

  it("keeps server upload failure alerts off the upload response path", () => {
    const scheduler = source("src/app/api/drive/upload-alert-scheduler.ts");
    expect(scheduler).toContain("after(run)");
    expect(scheduler).toContain("void run()");
    expect(scheduler).toContain("notifyUploadFailure(alert)");

    for (const file of [
      "src/app/api/drive/upload/route.ts",
      "src/app/api/drive/proxy-upload/route.ts",
      "src/app/api/drive/upload-chunk/route.ts",
      "src/app/api/drive/finalize/route.ts",
    ]) {
      const contents = source(file);
      expect(contents, `${file} should schedule alert delivery after the route response`).toContain("scheduleUploadFailureAlert");
      expect(contents, `${file} must not wait on email/Telegram alert delivery before replying`).not.toContain("await notifyUploadFailure");
      expect(contents, `${file} must not import the blocking alert sender directly`).not.toContain("@/lib/upload-alerts");
    }

    const clientAlertRoute = source("src/app/api/drive/upload-failure/route.ts");
    expect(clientAlertRoute).toContain("await notifyUploadFailure");
  });

  it("keeps revision attachments private instead of writing them to public avatars/kickback", () => {
    const kickback = source("src/components/kickback-modal.tsx");
    expect(kickback).toContain('PRIVATE_ATTACHMENT_BUCKET = "support-attachments"');
    expect(kickback).toContain('fetch("/api/support/uploads"');
    expect(kickback).toContain("uploadToSignedUrl");
    expect(kickback).toContain("/api/support/attachment?");
    expect(kickback).not.toContain('storage.from("avatars").upload');
    expect(kickback).not.toContain("getPublicUrl");

    const migration = source("supabase/migrations/0054_private_kickback_attachments.sql");
    expect(migration).toContain("= 'profiles'");
    expect(migration).not.toContain("IN ('profiles', 'kickback')");
  });

  it("warms and privately caches HEIC previews so viewing is not repeatedly black while converting", () => {
    const imagePreview = source("src/app/api/media/image-preview/route.ts");
    expect(imagePreview).toContain("inFlightPreviewBuilds");
    expect(imagePreview).toContain('"private, max-age=86400, immutable"');
    expect(imagePreview).toContain("PREVIEW_SIZES");
    expect(imagePreview).toContain("previewSizeFromRequest");
    expect(imagePreview).toContain("schedulePreviewCacheWrite");
    expect(imagePreview).toContain("after(() => writeCachedPreview");
    expect(imagePreview).toContain("MAX_DRIVE_THUMBNAIL_BYTES");
    expect(imagePreview).toContain("PREVIEW_FAST_THUMBNAIL_LOOKUP_TIMEOUT_MS");
    expect(imagePreview).toContain("Drive thumbnail normalization");
    expect(imagePreview).toContain("firstAvailablePreview");
    expect(imagePreview).toContain("withNullTimeout");

    const imagePreviewLib = source("src/lib/image-preview.ts");
    expect(imagePreviewLib).toContain("warmBrowserImagePreview");
    expect(imagePreviewLib).toContain('cache: "force-cache"');
    expect(imagePreviewLib).toContain('params.set("size", opts.size)');

    const previewImage = source("src/components/preview-image.tsx");
    expect(previewImage).toContain("IMAGE_PREVIEW_LOAD_TIMEOUT_MS");
    expect(previewImage).toContain("fallbackSrc");
    expect(previewImage).toContain("wantsFullPreview");
    expect(previewImage).toContain('className.includes("object-contain")');
    expect(previewImage).toContain('size: "thumb"');
    expect(previewImage).toContain('size: "full"');
    expect(previewImage).toContain("shouldLoadPrimary");
    expect(previewImage).toContain("FULL_PREVIEW_LOAD_DELAY_MS");
    expect(previewImage).toContain("primaryDelayElapsed");
    expect(previewImage).toContain("FALLBACK_PREVIEW_LOAD_TIMEOUT_MS");
    expect(previewImage).toContain("timedOutFallbackSrcs");
    expect(previewImage).toContain("!fallbackSrc || fallbackLoaded || fallbackFailed || fallbackTimedOut || primaryDelayElapsed");

    const mediaPage = source("src/components/pages/media-page.tsx");
    expect(mediaPage).toContain("const currentUrl = mediaDisplayUrl(lightboxAsset)");
    expect(mediaPage).toContain("warmBrowserImagePreview(currentUrl, { mimeType: lightboxAsset.mimeType, fileName: lightboxAsset.name })");
    expect(mediaPage).toContain('warmBrowserImagePreview(mediaDisplayUrl(neighbor), { mimeType: neighbor.mimeType, fileName: neighbor.name, size: "thumb" })');

    for (const file of [
      "src/components/pages/media-page.tsx",
      "src/components/create-post-modal.tsx",
      "src/components/media-picker.tsx",
      "src/components/asset-review-drawer.tsx",
    ]) {
      expect(source(file), file).toContain("warmBrowserImagePreview");
    }

    for (const file of ["src/components/pages/media-page.tsx", "src/components/media-picker.tsx"]) {
      const src = source(file);
      expect(src, file).toContain("browserImagePreviewUrl");
      expect(src, file).toContain('size: "full"');
      expect(src, file).toContain('size: "thumb"');
      expect(src, file).toContain("warmedPreviewKeysRef");
      expect(src, file).toContain("absoluteAppUrl");
    }
  });

  it("renders AI assets through an authenticated storage-key proxy and publishes via signed app URLs", () => {
    const route = source("src/app/api/ai/asset/route.ts");
    expect(route).toContain('const BUCKET = "ai-assets"');
    expect(route).toContain("parseAiAssetStorageKey");
    expect(route).toContain("verifyAiAssetToken");
    expect(route).toContain("userHasWorkspaceAccess");
    expect(route).toContain(".eq(\"workspace_id\", workspaceId)");
    expect(route).toContain("streamWithInactivityTimeout");
    expect(route).toContain("Supabase AI asset stream");

    const assetUrl = source("src/lib/ai/asset-url.ts");
    expect(assetUrl).toContain("/api/ai/asset?key=");

    const pipeline = source("src/lib/pipeline-context.tsx");
    expect(pipeline).toContain("aiAssetProxyUrls(row.asset_storage_keys)");

    const persist = source("src/lib/ai/persist.ts");
    expect(persist).toContain("aiAssetPublishUrl(a.storageKey)");
    expect(persist).not.toContain("asset_urls: assets.map((a) => a.signedUrl)");

    const worker = source("src/lib/ai/worker.ts");
    expect(worker).toContain("moveAssetsBestEffort");
    expect(worker).toContain("AI asset re-key rollback");
    expect(worker).toContain(".select(\"id\")");
    expect(worker).toContain("AI asset re-key did not update the post row");
  });

  it("renders media-library videos with source fallback instead of a permanent black preview", () => {
    const mediaVideo = source("src/components/media-video.tsx");
    expect(mediaVideo).toContain("DEFAULT_VIDEO_LOAD_TIMEOUT_MS = 45_000");
    expect(mediaVideo).toContain("attemptedSource");
    expect(mediaVideo).toContain('preload !== "none" || attempted');
    expect(mediaVideo).toContain("advanceSource");
    expect(mediaVideo).toContain("onLoadedData");
    expect(mediaVideo).toContain("retrySources");
    expect(mediaVideo).toContain("Video preview unavailable");
    expect(mediaVideo).toContain("Retry");

    for (const file of [
      "src/components/pages/media-page.tsx",
      "src/components/media-picker.tsx",
      "src/components/asset-review-drawer.tsx",
      "src/components/card-thumbnail-media.tsx",
    ]) {
      const src = source(file);
      expect(src, file).toContain("MediaVideo");
      expect(src, file).not.toContain("<video");
    }
    expect(source("src/components/pages/media-page.tsx")).toContain("mediaVideoSources");
    expect(source("src/components/media-picker.tsx")).toContain("mediaVideoSources");
    expect(source("src/components/card-thumbnail-media.tsx")).toContain("videoPreviewFrameUrl");
    expect(source("src/components/asset-review-drawer.tsx")).toContain("resolvedVideoSources");
  });

  it("does not block completed uploads on optional video playback optimization", () => {
    for (const file of [
      "src/components/create-post-modal.tsx",
      "src/components/asset-review-drawer.tsx",
      "src/components/media-picker.tsx",
      "src/components/pages/media-page.tsx",
    ]) {
      const contents = source(file);
      expect(contents, file).not.toContain("Optimizing playback");
      expect(contents, file).toContain("Promise.allSettled(playbackOptimizations.map((run) => run()))");
    }

    const mediaPage = source("src/components/pages/media-page.tsx");
    expect(mediaPage).toContain("A direct Media Library upload is not complete until the DB row exists.");
    expect(mediaPage).not.toContain('.from("media_assets")\n            .insert');
    expect(mediaPage).toContain("upsertMediaAsset");
    expect(mediaPage).toContain("saved to Media Library");
  });

  it("keeps full Drive metadata when mirroring uploaded videos into Media Library", () => {
    const helper = source("src/lib/media-assets.ts");
    for (const field of ["file_id", "publish_url", "drive_proxy_url", "playback_url", "playback_storage_key", "mime_type", "size_bytes"]) {
      expect(helper, field).toContain(field);
    }
    expect(helper).toContain("mediaUrlAliases({ url, fileId, publishUrl, driveProxyUrl, playbackUrl })");
    expect(helper).toContain('.eq("file_id", fileId)');
    expect(helper).toContain('.eq("playback_storage_key", playbackStorageKey)');
    expect(helper).toContain("lookupError");
    expect(helper).toContain("updateError");
    expect(helper).toContain("MEDIA_ASSET_SYNC_TIMEOUT_MS");
    expect(helper).toContain("withMediaAssetTimeout");
    expect(helper).toContain("throw new Error(`Media asset lookup failed:");
    expect(helper).toContain("throw new Error(`Media asset update failed:");
    expect(helper).toContain("throw new Error(`Media asset insert failed:");

    for (const file of [
      "src/components/create-post-modal.tsx",
      "src/components/asset-review-drawer.tsx",
      "src/components/repurpose-modal.tsx",
    ]) {
      const contents = source(file);
      expect(contents, file).toContain("publishUrl:");
      expect(contents, file).toContain("driveProxyUrl:");
      expect(contents, file).toContain("playbackUrl:");
      expect(contents, file).toContain("mimeType:");
      expect(contents, file).toContain("size:");
    }
  });

  it("does not clear a completed create-post upload until the post insert is confirmed", () => {
    const pipeline = source("src/lib/pipeline-context.tsx");
    expect(pipeline).toContain("Promise<ContentCard | null>");
    expect(pipeline).toContain("POST_CREATE_TIMEOUT_MS");
    expect(pipeline).toContain(".abortSignal(controller.signal)");
    expect(pipeline).toContain("Save timed out before the database confirmed the post.");
    expect(pipeline).toContain("No post row was created. Check workspace access and retry.");
    expect(pipeline).toContain("return savedCard");

    const createPost = source("src/components/create-post-modal.tsx");
    expect(createPost).toContain("const createdCard = await createCard");
    expect(createPost).toContain("if (!createdCard) return;");
    expect(createPost).toContain("usedIn: createdCard.id");
  });

  it("preserves Media Library rows when a refresh fails", () => {
    const mediaPage = source("src/components/pages/media-page.tsx");
    expect(mediaPage).toContain("mediaLoadError");
    expect(mediaPage).toContain("setMediaReloadNonce");
    expect(mediaPage).toContain("Showing the last loaded files");
    expect(mediaPage).not.toContain("setMedia([])");

    const mediaPicker = source("src/components/media-picker.tsx");
    expect(mediaPicker).toContain("mediaLoadError");
    expect(mediaPicker).toContain("setMediaReloadNonce");
    expect(mediaPicker).toContain("Showing the last loaded files");
    expect(mediaPicker).not.toContain("setMediaAssets([])");
  });

  it("confirms save before success and surfaces media mirror failures", () => {
    const createPost = source("src/components/create-post-modal.tsx");
    expect(createPost).toContain("reportUploadFailureForTelemetry");
    expect(createPost).toContain("create_post_media_asset_sync");
    expect(createPost).toContain("Post saved, but Media Library linking needs a retry");

    const drawer = source("src/components/asset-review-drawer.tsx");
    expect(drawer).toContain("drawer_media_asset_sync");
    expect(drawer).toContain("Cover uploaded, but saving it to Media Library failed.");
    expect(drawer).toContain("Uploaded, but Media Library linking needs a retry.");

    const repurpose = source("src/components/repurpose-modal.tsx");
    expect(repurpose).toContain("const createdCard = await createCard");
    expect(repurpose).toContain("if (!createdCard) return;");
    expect(repurpose).toContain("Promise.allSettled(mediaSyncs)");
    expect(repurpose).toContain("usedIn: createdCard.id");
    expect(repurpose).toContain("Media Library linking needs a retry");

    const mediaPicker = source("src/components/media-picker.tsx");
    expect(mediaPicker).toContain("mediaAssetSyncs");
    expect(mediaPicker).toContain("Promise.allSettled(mediaAssetSyncs.map((run) => run()))");
    expect(mediaPicker).toContain("media_picker_media_asset_sync");
    expect(mediaPicker).toContain("The post attachment still worked");
  });

  it("binds resumable Drive chunk uploads to the minted workspace session", () => {
    const session = source("src/lib/drive-upload-session.ts");
    expect(session).toContain("signDriveUploadSession");
    expect(session).toContain("verifyDriveUploadSessionToken");
    expect(session).toContain("workspaceId");
    expect(session).toContain("userId");

    const upload = source("src/app/api/drive/upload/route.ts");
    expect(upload).toContain("uploadToken: signDriveUploadSession");

    const chunk = source("src/app/api/drive/upload-chunk/route.ts");
    expect(chunk).toContain('request.headers.get("x-upload-token")');
    expect(chunk).toContain("verifyDriveUploadSessionToken");
    // The workspace-bound session check still gates every chunk, but a failure now
    // returns the truthful `sessionInvalid` reason (logged + alerted) instead of a bare
    // 403 that the client mislabeled as "Storage rejected the upload."
    expect(chunk).toContain("sessionInvalidError");

    const client = source("src/lib/drive-upload.ts");
    expect(client).toContain("uploadToken");
    expect(client).toContain('xhr.setRequestHeader("X-Upload-Token", session.uploadToken)');
  });

  it("routes Media Library deletes through the server delete-media route, never a direct DB delete", () => {
    const mediaPage = source("src/components/pages/media-page.tsx");
    expect(mediaPage).toContain('fetch("/api/drive/delete-media"');
    // The browser must not delete media_assets rows directly anymore (that orphaned the
    // Drive file forever).
    expect(mediaPage).not.toMatch(/supabase\.from\("media_assets"\)\.delete\(\)/);

    const route = source("src/app/api/drive/delete-media/route.ts");
    // Server owns the cleanup: verify the Drive parent, strip public access, then TRASH
    // (never a permanent DELETE the service account can't perform).
    expect(route).toContain("getFileMetadata");
    expect(route).toContain("removePublicPermissions");
    expect(route).toContain("trashDriveFile");
    expect(route).not.toContain('method: "DELETE"');
  });

  it("does not expose private Drive stream tokens through app media copy or preview helpers", () => {
    const googleDrive = source("src/lib/google-drive.ts");
    expect(googleDrive).toContain("const params = new URLSearchParams({ id: fileId })");
    expect(googleDrive).toContain('signDriveStreamToken(fileId, workspaceId, expiresAt, "publish")');

    const imagePreview = source("src/lib/image-preview.ts");
    expect(imagePreview).not.toContain('params.set("token"');

    const mediaPage = source("src/components/pages/media-page.tsx");
    const mediaPicker = source("src/components/media-picker.tsx");
    expect(mediaPage).toContain("stripPrivateMediaToken(asset.playbackUrl || asset.driveProxyUrl || asset.url)");
    expect(mediaPicker).toContain("stripPrivateMediaToken(asset.playbackUrl || asset.driveProxyUrl || asset.url)");
  });

  it("guards production-mutating e2e specs and ignores generated evidence", () => {
    const dragSpec = source("e2e/drag.spec.ts");
    expect(dragSpec).toContain("guardRuntimeTarget()");
    expect(dragSpec).toContain("QA_ALLOW_PROD_DRAG");
    expect(dragSpec).toContain("Refusing drag e2e against production backend/site");

    const gitignore = source(".gitignore");
    expect(gitignore).toContain("perf/drag-evidence/drag-*/");
  });

  it("guards license uploads against double submission and shows progress", () => {
    const createPost = source("src/components/create-post-modal.tsx");
    expect(createPost).toContain("licenseUploading");
    expect(createPost).toContain("disabled={licenseUploading || submitting}");
    expect(createPost).toContain("onProgress: setUploadProgress");

    const drawer = source("src/components/asset-review-drawer.tsx");
    expect(drawer).toContain("if (uploading) return;");
    expect(drawer).toContain("disabled={uploading}");
    expect(drawer).toContain("onProgress: setUploadProgress");
  });

  it("renders support attachments through the authenticated proxy, not stored signed URLs", () => {
    const threadView = source("src/components/support/thread-view.tsx");
    expect(threadView).toContain("attachmentProxyUrl(a.storageKey)");
    expect(threadView).toContain("/api/support/attachment?key=");
    expect(threadView).not.toContain("href={a.signedUrl}");
    expect(threadView).not.toContain("src={a.signedUrl}");

    const route = source("src/app/api/support/attachment/route.ts");
    expect(route).toContain("parseAttachmentStorageKey");
    expect(route).toContain("ownerUserId");
    expect(route).toContain("userSupportAttachmentAccess");
    expect(route).toContain('.eq("workspace_id", workspaceId)');
    expect(route).toContain('.eq("status", "active")');
    expect(route).toContain('from("team_members")');
    expect(route).toContain('=== "superadmin"');
    expect(route).toContain('from("support_messages")');
    expect(route).toContain('from("support_threads")');
    expect(route).toContain('.eq("created_by", userId)');
    expect(route).toContain("streamWithInactivityTimeout");
    expect(route).toContain("Supabase support attachment stream");
    expect(route).toContain("not available to this user");
  });

  it("keeps same-origin media tags authenticated with a server-readable session cookie", () => {
    const authContext = source("src/lib/auth-context.tsx");
    expect(authContext).toContain('fetch("/api/auth/session-cookie"');
    expect(authContext).toContain("syncServerSessionCookieBestEffort(session.access_token)");
    expect(authContext).toContain("syncServerSessionCookieBestEffort(data.session.access_token)");
    expect(authContext).toContain('fetch("/api/auth/logout", { method: "POST" })');

    const sessionCookieRoute = source("src/app/api/auth/session-cookie/route.ts");
    expect(sessionCookieRoute).toContain('res.cookies.set("sb-access-token"');
    expect(sessionCookieRoute).toContain("httpOnly: true");
    expect(sessionCookieRoute).toContain("admin.auth.getUser(token)");
  });

  it("falls back to short-lived signed media view URLs when the server cookie is stale", () => {
    const viewUrlRoute = source("src/app/api/media/view-url/route.ts");
    expect(viewUrlRoute).toContain("PRIVATE_VIEW_TOKEN_TTL_MS = 15 * 60 * 1000");
    expect(viewUrlRoute).toContain("requireBearerTeamRole");
    expect(viewUrlRoute).toContain("isKnownAppDriveFile");
    expect(viewUrlRoute).toContain('signDriveStreamToken(target.fileId, auth.workspaceId');
    expect(viewUrlRoute).toContain('"private"');
    expect(viewUrlRoute).toContain('"Cache-Control": "no-store"');

    const mediaViewUrl = source("src/lib/media-view-url.ts");
    expect(mediaViewUrl).toContain("signedMediaViewUrl");
    expect(mediaViewUrl).toContain("supabase.auth.getSession()");
    // Sign requests coalesce into one batched POST per fresh-device mount burst.
    expect(mediaViewUrl).toContain("/api/media/view-url/batch");
    expect(mediaViewUrl).toContain("Authorization: `Bearer ${token}`");

    const previewImage = source("src/components/preview-image.tsx");
    expect(previewImage).toContain("signAndRetry");
    expect(previewImage).toContain("signedMediaViewUrl(source)");

    const mediaVideo = source("src/components/media-video.tsx");
    expect(mediaVideo).toContain("signAndRetryCurrentSource");
    expect(mediaVideo).toContain("signedMediaViewUrl(source)");

    const driveStream = source("src/app/api/drive/stream/route.ts");
    expect(driveStream).toContain('signedPurpose === "publish"');
    expect(driveStream).toContain('"private, max-age=86400');

    const imagePreview = source("src/app/api/media/image-preview/route.ts");
    // Thumb + publish are served public (edge-cacheable); private stays private.
    expect(imagePreview).toContain('auth.signedPurpose === "publish" || auth.signedPurpose === "thumb" ? "publish" : "private"');
    expect(imagePreview).toContain('cacheScope === "publish"');
    // A thumb capability must never reach the full-resolution path.
    expect(imagePreview).toContain('Thumbnail token cannot access full-resolution media');
  });

  it("does not authorize Drive media or HEIC previews from Referer alone", () => {
    for (const file of [
      "src/app/api/drive/stream/route.ts",
      "src/app/api/media/image-preview/route.ts",
    ]) {
      const contents = source(file);
      expect(contents, file).toContain("requireRole");
      expect(contents, file).toContain("requiresWorkspaceAppProperty");
      expect(contents, file).toContain("!auth.signed");
      expect(contents, file).toContain("mutable");
      expect(contents, file).not.toContain('headers.get("referer")');
      expect(contents, file).not.toContain("refOk");
    }
  });
});
