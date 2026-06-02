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
  authMocks.requireBearerTeamRole.mockResolvedValue({ user: { id: "user-1" } });
  rateLimitMocks.getClientIp.mockReturnValue("1.2.3.4");
  rateLimitMocks.consume.mockResolvedValue({ allowed: true, remaining: 60, resetAt: new Date() });
  driveMocks.getRootFolderId.mockReturnValue("root-folder");
  driveMocks.ensureSubfolder.mockResolvedValue("sub-folder");
  driveMocks.createResumableUploadSession.mockResolvedValue({ uploadUri: "https://upload.example/session" });
});

describe("POST /api/drive/upload", () => {
  it("rejects unsupported MIME types before creating a Drive session", async () => {
    const res = await POST(makeRequest({
      fileName: "brief.pdf",
      mimeType: "application/pdf",
      folder: "raw-files",
      fileSize: 1024,
    }));

    expect(res.status).toBe(415);
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
    );
  });
});
