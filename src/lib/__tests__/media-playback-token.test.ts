import { afterEach, describe, expect, it, vi } from "vitest";
import { signPlaybackViewToken, verifyPlaybackViewToken } from "../media-playback-token";

const OLD_ENV = { ...process.env };
const STORAGE_KEY = "00000000-0000-0000-0000-000000000001/videos/clip.mp4";
const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";

function setNodeEnv(value: "production" | "development" | "test") {
  Object.defineProperty(process.env, "NODE_ENV", { value, configurable: true, enumerable: true, writable: true });
}

afterEach(() => {
  vi.useRealTimers();
  process.env = { ...OLD_ENV };
});

describe("media playback view tokens", () => {
  it("signs playback storage keys with workspace and expiry claims", () => {
    vi.setSystemTime(new Date("2026-06-25T00:00:00.000Z"));
    process.env.MEDIA_PLAYBACK_SIGNING_SECRET = "playback-signing-secret";

    const expiresAt = Date.now() + 60_000;
    const token = signPlaybackViewToken(STORAGE_KEY, WORKSPACE_ID, expiresAt);

    expect(verifyPlaybackViewToken(STORAGE_KEY, token)).toEqual({ workspaceId: WORKSPACE_ID, expiresAt });
    expect(verifyPlaybackViewToken(`${STORAGE_KEY}.tampered`, token)).toBeNull();
  });

  it("fails closed in production without a dedicated playback signing secret", () => {
    setNodeEnv("production");
    delete process.env.MEDIA_PLAYBACK_SIGNING_SECRET;
    process.env.DRIVE_STREAM_SIGNING_SECRET = "drive-secret";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-secret";

    expect(() => signPlaybackViewToken(STORAGE_KEY, WORKSPACE_ID)).toThrow("Media playback signing secret is not configured");
    expect(verifyPlaybackViewToken(STORAGE_KEY, "v1.9999999999999.00000000-0000-0000-0000-000000000001.signature")).toBeNull();
  });
});
