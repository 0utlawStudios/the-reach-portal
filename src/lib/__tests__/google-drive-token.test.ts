import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signDriveStreamToken, verifyDriveStreamToken } from "@/lib/google-drive";

const OLD_ENV = process.env.DRIVE_STREAM_SIGNING_SECRET;
const FILE_ID = "abcdefghijklmnopqrst";
const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";

beforeEach(() => {
  process.env.DRIVE_STREAM_SIGNING_SECRET = "test-drive-stream-secret";
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-24T00:00:00.000Z"));
});

afterEach(() => {
  if (OLD_ENV === undefined) delete process.env.DRIVE_STREAM_SIGNING_SECRET;
  else process.env.DRIVE_STREAM_SIGNING_SECRET = OLD_ENV;
  vi.useRealTimers();
});

describe("Drive stream tokens", () => {
  it("signs Drive stream tokens with workspace and expiry claims", () => {
    const expiresAt = Date.now() + 60_000;
    const token = signDriveStreamToken(FILE_ID, WORKSPACE_ID, expiresAt);

    expect(verifyDriveStreamToken(FILE_ID, token)).toEqual({ workspaceId: WORKSPACE_ID, expiresAt });
    expect(verifyDriveStreamToken("other-file-id-abcdefghijkl", token)).toBeNull();
  });

  it("rejects expired and legacy fileId-only stream tokens", () => {
    const expired = signDriveStreamToken(FILE_ID, WORKSPACE_ID, Date.now() - 1);
    const legacy = createHmac("sha256", "test-drive-stream-secret")
      .update(FILE_ID)
      .digest("base64url");

    expect(verifyDriveStreamToken(FILE_ID, expired)).toBeNull();
    expect(verifyDriveStreamToken(FILE_ID, legacy)).toBeNull();
  });
});
