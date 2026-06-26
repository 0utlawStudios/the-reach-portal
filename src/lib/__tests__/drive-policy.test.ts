import { describe, expect, it } from "vitest";
import {
  DRIVE_BATCH_CONCURRENCY,
  DRIVE_RESUMABLE_CHUNK_SIZE,
  DRIVE_UPLOAD_CHUNK_RATE_LIMIT,
  inferDriveMimeTypeFromName,
  isAllowedDriveUploadForFolder,
  isDrivePublishableMediaMime,
  MAX_DRIVE_MEDIA_FILE_SIZE,
  MAX_DRIVE_PROXY_FILE_SIZE,
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

  it("enforces one 500MB cap and a chunk rate limit that never self-throttles a max upload", () => {
    expect(MAX_DRIVE_MEDIA_FILE_SIZE).toBe(500 * 1024 * 1024);
    // Chunk size must stay 256KB-aligned (Google rejects non-256KB non-final chunks).
    // A resumable chunk is a RAW request body (no multipart overhead), so it may exceed the
    // multipart proxy threshold while staying under Vercel's ~4.5MB request-body limit.
    expect(DRIVE_RESUMABLE_CHUNK_SIZE % (256 * 1024)).toBe(0);
    expect(MAX_DRIVE_PROXY_FILE_SIZE).toBeLessThan(4.5 * 1024 * 1024);
    expect(DRIVE_RESUMABLE_CHUNK_SIZE).toBeLessThan(4.5 * 1024 * 1024);

    // Lockstep invariant: the chunk limit must cover a full concurrent batch of
    // max-size uploads, or large files self-throttle into a 429.
    const chunksPerMaxFile = Math.ceil(MAX_DRIVE_MEDIA_FILE_SIZE / DRIVE_RESUMABLE_CHUNK_SIZE);
    expect(chunksPerMaxFile).toBe(125);
    expect(DRIVE_UPLOAD_CHUNK_RATE_LIMIT).toBeGreaterThanOrEqual(chunksPerMaxFile * DRIVE_BATCH_CONCURRENCY);
  });

  it("keeps publish surfaces image/video while allowing source files in raw-files", () => {
    expect(isDrivePublishableMediaMime("application/pdf", "brief.pdf")).toBe(false);
    expect(isAllowedDriveUploadForFolder("raw-files", "application/pdf", "brief.pdf")).toBe(true);
    expect(isAllowedDriveUploadForFolder("media-library", "application/pdf", "brief.pdf")).toBe(false);
    expect(isAllowedDriveUploadForFolder("thumbnails", "image/avif", "cover.avif")).toBe(true);
  });
});
