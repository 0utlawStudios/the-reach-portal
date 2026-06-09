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
    expect(createPost).toContain('ref={fileInputRef} type="file" multiple accept="image/*,video/*"');
    expect(createPost).toContain("onSelectMany={addMediaPickerSelections}");

    const mediaPage = source("src/components/pages/media-page.tsx");
    expect(mediaPage).toContain('ref={fileInputRef} type="file" multiple accept="image/*,video/*"');
    expect(mediaPage).toContain('uploadManyToDrive(fileList, "media-library"');
  });
});
