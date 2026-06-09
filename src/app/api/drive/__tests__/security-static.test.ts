import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const DRIVE_STREAM_SRC = readFileSync(join(process.cwd(), "src/app/api/drive/stream/route.ts"), "utf8");
const DRIVE_FINALIZE_SRC = readFileSync(join(process.cwd(), "src/app/api/drive/finalize/route.ts"), "utf8");
const DRIVE_PROXY_UPLOAD_SRC = readFileSync(join(process.cwd(), "src/app/api/drive/proxy-upload/route.ts"), "utf8");
const DRIVE_POLICY_SRC = readFileSync(join(process.cwd(), "src/lib/drive-policy.ts"), "utf8");
const GOOGLE_DRIVE_SRC = readFileSync(join(process.cwd(), "src/lib/google-drive.ts"), "utf8");

describe("Drive route security contracts", () => {
  it("does not allow arbitrary Drive streaming on a forged Referer alone", () => {
    expect(DRIVE_STREAM_SRC).toContain("isKnownAppDriveFile(fileId)");
    expect(DRIVE_STREAM_SRC).toContain("isInAppManagedDriveFolder(fileId)");
    expect(DRIVE_STREAM_SRC).toContain("refOk && (await isKnownAppDriveFile(fileId) || await isInAppManagedDriveFolder(fileId))");
    expect(DRIVE_STREAM_SRC).not.toContain("return { ok: refOk || tokenOk");
    expect(DRIVE_STREAM_SRC).toContain('from("media_assets")');
    expect(DRIVE_STREAM_SRC).toContain('from("posts")');
    expect(DRIVE_STREAM_SRC).toContain("VALID_DRIVE_FOLDERS.map");
    expect(DRIVE_STREAM_SRC).toContain("verifyDriveStreamToken(fileId, signedToken)");
    expect(GOOGLE_DRIVE_SRC).toContain("signDriveStreamToken");
  });

  it("validates Drive parent folders before publicizing a finalized file", () => {
    const metadataIdx = DRIVE_FINALIZE_SRC.indexOf("const meta = await getFileMetadata(fileId)");
    const parentCheckIdx = DRIVE_FINALIZE_SRC.indexOf("belongsToAppFolder");
    const permissionIdx = DRIVE_FINALIZE_SRC.indexOf("await setPublicPermission(fileId)");
    const folderValidationIdx = DRIVE_FINALIZE_SRC.indexOf("VALID_DRIVE_FOLDERS.includes(folder)");
    const singleFolderIdx = DRIVE_FINALIZE_SRC.indexOf("const allowedParentId = await ensureSubfolder(folder, rootId)");
    expect(metadataIdx).toBeGreaterThan(-1);
    expect(folderValidationIdx).toBeGreaterThan(-1);
    expect(folderValidationIdx).toBeLessThan(metadataIdx);
    expect(parentCheckIdx).toBeGreaterThan(metadataIdx);
    expect(permissionIdx).toBeGreaterThan(parentCheckIdx);
    expect(singleFolderIdx).toBeGreaterThan(metadataIdx);
    expect(DRIVE_FINALIZE_SRC).not.toContain("VALID_DRIVE_FOLDERS.map");
    expect(DRIVE_FINALIZE_SRC).toContain("isAllowedDriveMediaMime(mimeType)");
    expect(DRIVE_FINALIZE_SRC).toContain("meta.size > MAX_DRIVE_MEDIA_FILE_SIZE");
    expect(GOOGLE_DRIVE_SRC).toContain("fields=id,name,mimeType,size,parents");
  });

  it("rejects proxy uploads above the small-file threshold before buffering", () => {
    expect(DRIVE_POLICY_SRC).toContain("MAX_DRIVE_PROXY_FILE_SIZE = 4 * 1024 * 1024");
    const proxyLimitIdx = DRIVE_PROXY_UPLOAD_SRC.indexOf("file.size > MAX_DRIVE_PROXY_FILE_SIZE");
    const bufferIdx = DRIVE_PROXY_UPLOAD_SRC.indexOf("await file.arrayBuffer()");
    expect(proxyLimitIdx).toBeGreaterThan(-1);
    expect(bufferIdx).toBeGreaterThan(proxyLimitIdx);
    expect(DRIVE_PROXY_UPLOAD_SRC).toContain("Use resumable upload");
  });

  it("returns signed app stream URLs from both Drive upload paths", () => {
    expect(DRIVE_PROXY_UPLOAD_SRC).toContain("getStreamUrl(fileId)");
    expect(DRIVE_FINALIZE_SRC).toContain("getStreamUrl(fileId)");
    expect(GOOGLE_DRIVE_SRC).toContain("token: signDriveStreamToken(fileId)");
  });

  it("sanitizes stream route catch responses before returning them to the browser", () => {
    expect(DRIVE_STREAM_SRC).toContain("sanitizeUnknownUploadError");
    expect(DRIVE_STREAM_SRC).toContain("statusForSanitizedDriveError(sanitized)");
    expect(DRIVE_STREAM_SRC).not.toContain("JSON.stringify({ error: message })");
  });
});
