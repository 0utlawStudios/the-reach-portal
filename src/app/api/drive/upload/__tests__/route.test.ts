import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  requireBearerTeamRole: vi.fn(),
}));

const rateLimitMocks = vi.hoisted(() => ({
  consume: vi.fn(),
  getClientIp: vi.fn(),
}));

const driveMocks = vi.hoisted(() => ({
  getRootFolderId: vi.fn(),
  ensureSubfolder: vi.fn(),
  createResumableUploadSession: vi.fn(),
}));

vi.mock("@/lib/auth/require", () => ({
  requireBearerTeamRole: authMocks.requireBearerTeamRole,
}));

vi.mock("@/lib/rate-limit", () => ({
  consume: rateLimitMocks.consume,
  getClientIp: rateLimitMocks.getClientIp,
}));

vi.mock("@/lib/google-drive", () => ({
  getRootFolderId: driveMocks.getRootFolderId,
  ensureSubfolder: driveMocks.ensureSubfolder,
  createResumableUploadSession: driveMocks.createResumableUploadSession,
}));

import { POST } from "../route";

function makeRequest(body: Record<string, unknown>) {
  return {
    headers: { get: () => "Bearer test-token" },
    json: () => Promise.resolve(body),
  } as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  authMocks.requireBearerTeamRole.mockResolvedValue({
    user: { id: "user-1" },
    email: "creator@example.com",
    role: "editor",
    workspaceId: "00000000-0000-0000-0000-000000000001",
  });
  rateLimitMocks.getClientIp.mockReturnValue("1.2.3.4");
  rateLimitMocks.consume.mockResolvedValue({ allowed: true, remaining: 60, resetAt: new Date() });
  driveMocks.getRootFolderId.mockReturnValue("root-folder");
  driveMocks.ensureSubfolder.mockResolvedValue("sub-folder");
  driveMocks.createResumableUploadSession.mockResolvedValue({ uploadUri: "https://upload.example/session" });
});

describe("POST /api/drive/upload", () => {
  it("rejects unsupported MIME types before creating a Drive session", async () => {
    const res = await POST(makeRequest({
      fileName: "malware.exe",
      mimeType: "application/octet-stream",
      folder: "raw-files",
      fileSize: 1024,
    }));

    expect(res.status).toBe(415);
    expect(driveMocks.ensureSubfolder).not.toHaveBeenCalled();
    expect(driveMocks.createResumableUploadSession).not.toHaveBeenCalled();
  });

  it("rejects non-publishable source files outside raw-files", async () => {
    const res = await POST(makeRequest({
      fileName: "brief.pdf",
      mimeType: "application/pdf",
      folder: "media-library",
      fileSize: 1024,
    }));

    expect(res.status).toBe(415);
    expect(driveMocks.ensureSubfolder).not.toHaveBeenCalled();
    expect(driveMocks.createResumableUploadSession).not.toHaveBeenCalled();
  });

  it("allows source files in raw-files", async () => {
    const res = await POST(makeRequest({
      fileName: "client-rights.pdf",
      mimeType: "application/octet-stream",
      folder: "raw-files",
      fileSize: 4096,
    }));

    expect(res.status).toBe(200);
    expect(driveMocks.createResumableUploadSession).toHaveBeenCalledWith(
      expect.stringMatching(/client-rights\.pdf$/),
      "application/pdf",
      "sub-folder",
      4096,
      "00000000-0000-0000-0000-000000000001",
    );
  });

  it("requires fileSize before creating a Drive session", async () => {
    const res = await POST(makeRequest({
      fileName: "hero.png",
      mimeType: "image/png",
      folder: "raw-files",
    }));

    expect(res.status).toBe(400);
    expect(driveMocks.ensureSubfolder).not.toHaveBeenCalled();
    expect(driveMocks.createResumableUploadSession).not.toHaveBeenCalled();
  });

  it("rejects oversize files before creating a Drive session", async () => {
    const res = await POST(makeRequest({
      fileName: "huge.mp4",
      mimeType: "video/mp4",
      folder: "raw-files",
      fileSize: 251 * 1024 * 1024,
    }));

    expect(res.status).toBe(413);
    expect(driveMocks.ensureSubfolder).not.toHaveBeenCalled();
    expect(driveMocks.createResumableUploadSession).not.toHaveBeenCalled();
  });

  it("normalizes an allowed MIME type and creates a resumable session", async () => {
    const res = await POST(makeRequest({
      fileName: "Reach Hero.PNG",
      mimeType: "IMAGE/PNG; charset=binary",
      folder: "media-library",
      fileSize: 2048,
    }));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.uploadUri).toBe("https://upload.example/session");
    expect(driveMocks.createResumableUploadSession).toHaveBeenCalledWith(
      expect.stringMatching(/Reach_Hero\.PNG$/),
      "image/png",
      "sub-folder",
      2048,
      "00000000-0000-0000-0000-000000000001",
    );
  });

  it("marks this app's 60/min limiter as appRateLimited and does not create a Drive session", async () => {
    rateLimitMocks.consume.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: new Date(Date.now() + 30_000),
    });

    const res = await POST(makeRequest({
      fileName: "video.mp4",
      mimeType: "video/mp4",
      folder: "raw-files",
      fileSize: 5 * 1024 * 1024,
    }));
    const data = await res.json();

    expect(res.status).toBe(429);
    expect(data).toMatchObject({ errorReason: "appRateLimited", retryable: false });
    expect(driveMocks.ensureSubfolder).not.toHaveBeenCalled();
    expect(driveMocks.createResumableUploadSession).not.toHaveBeenCalled();
  });

  it("sanitizes Google Drive quota failures on resumable session creation", async () => {
    driveMocks.createResumableUploadSession.mockRejectedValueOnce(new Error(
      'Failed to create resumable session: 403 {"error":{"message":"raw quota details","errors":[{"reason":"userRateLimitExceeded","message":"raw quota details"}]}}',
    ));

    const res = await POST(makeRequest({
      fileName: "video.mp4",
      mimeType: "video/mp4",
      folder: "raw-files",
      fileSize: 5 * 1024 * 1024,
    }));
    const data = await res.json();

    expect(res.status).toBe(429);
    expect(data).toMatchObject({ errorReason: "driveRateLimited", retryable: true });
    expect(JSON.stringify(data)).not.toContain("raw quota details");
  });
});
