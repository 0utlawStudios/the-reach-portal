import { describe, expect, it } from "vitest";
import {
  inferDriveMimeTypeFromName,
  isAllowedDriveUploadForFolder,
  isDrivePublishableMediaMime,
  normalizeDriveMimeType,
} from "@/lib/drive-policy";

describe("Drive upload policy", () => {
  it("infers common upload MIME types from filenames when browsers send octet-stream", () => {
    expect(inferDriveMimeTypeFromName("rights-release.pdf")).toBe("application/pdf");
    expect(inferDriveMimeTypeFromName("campaign-brief.docx")).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(inferDriveMimeTypeFromName("source-pack.zip")).toBe("application/zip");
    expect(inferDriveMimeTypeFromName("edit.prproj")).toBe("application/vnd.adobe.premiere");
    expect(normalizeDriveMimeType("application/octet-stream", "clip.MOV")).toBe("video/quicktime");
  });

  it("keeps publish surfaces image/video while allowing source files in raw-files", () => {
    expect(isDrivePublishableMediaMime("application/pdf", "brief.pdf")).toBe(false);
    expect(isAllowedDriveUploadForFolder("raw-files", "application/pdf", "brief.pdf")).toBe(true);
    expect(isAllowedDriveUploadForFolder("media-library", "application/pdf", "brief.pdf")).toBe(false);
    expect(isAllowedDriveUploadForFolder("thumbnails", "image/avif", "cover.avif")).toBe(true);
  });
});
