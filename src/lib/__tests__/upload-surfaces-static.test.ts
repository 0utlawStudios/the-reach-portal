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
});
