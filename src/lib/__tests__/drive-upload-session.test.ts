import { afterEach, describe, expect, it } from "vitest";
import { signDriveUploadSession, verifyDriveUploadSessionToken } from "../drive-upload-session";

const OLD_ENV = { ...process.env };

function setNodeEnv(value: "production" | "development" | "test") {
  Object.defineProperty(process.env, "NODE_ENV", { value, configurable: true, enumerable: true, writable: true });
}

const parts = {
  uploadUri: "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=test",
  workspaceId: "00000000-0000-0000-0000-000000000001",
  userId: "user-1",
  folder: "media-library" as const,
  fileSize: 1024,
};

afterEach(() => {
  process.env = { ...OLD_ENV };
});

describe("Drive upload session tokens", () => {
  it("signs and verifies with the dedicated upload-session secret", () => {
    process.env.DRIVE_UPLOAD_SESSION_SECRET = "upload-session-secret";

    const token = signDriveUploadSession(parts, Date.now() + 60_000);

    expect(verifyDriveUploadSessionToken(token, parts)).toBe(true);
    expect(verifyDriveUploadSessionToken(token, { ...parts, workspaceId: "11111111-1111-4111-8111-111111111111" })).toBe(false);
  });

  it("keeps binding workspace, user, uploadUri, folder, and fileSize but not the fragile filename", () => {
    process.env.DRIVE_UPLOAD_SESSION_SECRET = "upload-session-secret";
    const token = signDriveUploadSession(parts);

    // Security binding preserved: any of these mismatching must reject.
    expect(verifyDriveUploadSessionToken(token, { ...parts, userId: "intruder" })).toBe(false);
    expect(verifyDriveUploadSessionToken(token, { ...parts, fileSize: 2048 })).toBe(false);
    expect(verifyDriveUploadSessionToken(token, { ...parts, folder: "raw-files" })).toBe(false);
    expect(verifyDriveUploadSessionToken(token, {
      ...parts,
      uploadUri: "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=other",
    })).toBe(false);
    // Filename/mime are intentionally NOT signed, so an emoji/accented name that
    // mangles in the X-File-Name header can never cause a self-inflicted 403.
    expect(verifyDriveUploadSessionToken(token, parts)).toBe(true);
  });

  it("fails closed in production without a dedicated upload-session secret", () => {
    setNodeEnv("production");
    delete process.env.DRIVE_UPLOAD_SESSION_SECRET;
    delete process.env.DRIVE_STREAM_TOKEN_SECRET;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-secret";

    expect(() => signDriveUploadSession(parts)).toThrow("Upload session signing secret is not configured");
    expect(verifyDriveUploadSessionToken("v1.9999999999999.signature", parts)).toBe(false);
  });
});
