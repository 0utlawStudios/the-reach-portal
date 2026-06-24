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

  it("renders preview-safe media URLs without changing publish-safe raw URLs", () => {
    const mediaPicker = source("src/components/media-picker.tsx");
    expect(mediaPicker).toContain('function mediaDisplayUrl(asset: Pick<MediaEntry, "url" | "driveProxyUrl" | "playbackUrl">): string');
    expect(mediaPicker).toContain("return asset.playbackUrl || asset.driveProxyUrl || asset.url");
    expect(mediaPicker).toContain("mediaAssetId: asset.assetId");
    expect(mediaPicker).toContain("videoPreviewFrameUrl(mediaDisplayUrl(asset))");
    expect(mediaPicker).toContain('preload="metadata"');
    expect(mediaPicker).toContain('controls');

    const mediaPage = source("src/components/pages/media-page.tsx");
    expect(mediaPage).toContain("getAutomaticMediaUsage(asset, cards)");
    expect(mediaPage).toContain("syncedUsedInValue(asset.usedIn, usage?.automaticCards || [])");
    expect(mediaPage).toContain("MEDIA_MANUAL_USED_TAG");
    expect(mediaPage).toContain("toggleManualUsed");
    expect(mediaPage).toContain('aria-label={`${asset.name} video preview`}');
    expect(mediaPage).toContain('className="max-w-full max-h-[60vh] object-contain rounded-lg bg-black"');
    expect(mediaPage).toContain('className="w-full h-[60vh] max-w-full max-h-[60vh] object-contain rounded-lg select-none"');

    const drawer = source("src/components/asset-review-drawer.tsx");
    expect(drawer).toContain("const displayUrl = file.playbackUrl || file.driveProxyUrl || file.url");
    expect(drawer).toContain('href={file.url}');
  });

  it("bounds direct Supabase Storage uploads outside the Drive media path", () => {
    for (const file of [
      "src/lib/support/use-support.ts",
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
  });

  it("keeps Drive video uploads when optional playback optimization fails", () => {
    const createPost = source("src/components/create-post-modal.tsx");
    expect(createPost).toContain("let playbackModule: typeof import(\"@/lib/media-playback\") | null = null");
    expect(createPost).toContain("Uploaded ${f.name}, but fast video playback was skipped.");
    expect(createPost).not.toContain("Retry this upload before creating the post.");

    const mediaPicker = source("src/components/media-picker.tsx");
    expect(mediaPicker).toMatch(
      /phase: "media_picker_playback_upload"[\s\S]*?Uploaded \$\{item\.file\.name\}, but fast video playback was skipped\.[\s\S]*?selections\.push/,
    );
    expect(mediaPicker).not.toContain("Playback optimization failed for ${item.file.name}");

    const drawer = source("src/components/asset-review-drawer.tsx");
    expect(drawer).toContain("let playbackModule: typeof import(\"@/lib/media-playback\") | null = null");
    expect(drawer).toMatch(
      /phase: "drawer_playback_upload"[\s\S]*?Uploaded \$\{file\.name\}, but fast video playback was skipped\.[\s\S]*?const publishUrl/,
    );
    expect(drawer).not.toContain("Playback optimization failed for ${file.name}");

    const mediaPage = source("src/components/pages/media-page.tsx");
    expect(mediaPage).toContain("let playbackModule: typeof import(\"@/lib/media-playback\") | null = null");
    expect(mediaPage).toContain('phase: "media_library_playback_upload"');
    expect(mediaPage).toContain("Uploaded ${file.name}, but fast video playback was skipped.");
    expect(mediaPage).toContain("playback_storage_key: asset.playbackStorageKey");
  });

  it("keeps optimized playback copies behind the app workspace gate, not public storage URLs", () => {
    const playbackUploadRoute = source("src/app/api/media/playback-upload/route.ts");
    expect(playbackUploadRoute).toContain("public: false");
    expect(playbackUploadRoute).not.toContain("getPublicUrl");
    expect(playbackUploadRoute).toContain('const playbackUrl = `/api/media/playback?key=${encodeURIComponent(storageKey)}`');

    const playbackRoute = source("src/app/api/media/playback/route.ts");
    expect(playbackRoute).toContain("requireRole(request, ALLOWED_DRIVE_ROLES as readonly WorkspaceRole[])");
    expect(playbackRoute).toContain("parsed.workspaceId !== auth.workspaceId");
    expect(playbackRoute).toContain("SUPABASE_SERVICE_ROLE_KEY");

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
  });

  it("warms and privately caches HEIC previews so viewing is not repeatedly black while converting", () => {
    const imagePreview = source("src/app/api/media/image-preview/route.ts");
    expect(imagePreview).toContain("inFlightPreviewBuilds");
    expect(imagePreview).toContain('"private, max-age=86400, immutable"');

    const imagePreviewLib = source("src/lib/image-preview.ts");
    expect(imagePreviewLib).toContain("warmBrowserImagePreview");
    expect(imagePreviewLib).toContain('cache: "force-cache"');

    const previewImage = source("src/components/preview-image.tsx");
    expect(previewImage).toContain("IMAGE_PREVIEW_LOAD_TIMEOUT_MS");
    expect(previewImage).toContain("setFailedSrc(displaySrc)");

    for (const file of [
      "src/components/pages/media-page.tsx",
      "src/components/create-post-modal.tsx",
      "src/components/media-picker.tsx",
      "src/components/asset-review-drawer.tsx",
    ]) {
      expect(source(file), file).toContain("warmBrowserImagePreview");
    }
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

  it("does not authorize Drive media or HEIC previews from Referer alone", () => {
    for (const file of [
      "src/app/api/drive/stream/route.ts",
      "src/app/api/media/image-preview/route.ts",
    ]) {
      const contents = source(file);
      expect(contents, file).toContain("requireRole");
      expect(contents, file).toContain("requiresWorkspaceAppProperty");
      expect(contents, file).not.toContain('headers.get("referer")');
      expect(contents, file).not.toContain("refOk");
    }
  });
});
