import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  requireBearerTeamRole: vi.fn(),
}));

const rateLimitMocks = vi.hoisted(() => ({
  consume: vi.fn(),
  getClientIp: vi.fn(),
}));

const driveMocks = vi.hoisted(() => ({
  ensureSubfolder: vi.fn(),
  getRootFolderId: vi.fn(),
  getStreamUrl: vi.fn(),
  getPublishStreamUrl: vi.fn(),
  getFileMetadata: vi.fn(),
}));

const alertMocks = vi.hoisted(() => ({
  notifyUploadFailure: vi.fn(),
  notifyUploadSuccess: vi.fn(),
}));

vi.mock("@/lib/auth/require", () => ({
  requireBearerTeamRole: authMocks.requireBearerTeamRole,
}));

vi.mock("@/lib/rate-limit", () => ({
  consume: rateLimitMocks.consume,
  getClientIp: rateLimitMocks.getClientIp,
}));

vi.mock("@/lib/google-drive", () => ({
  ensureSubfolder: driveMocks.ensureSubfolder,
  getRootFolderId: driveMocks.getRootFolderId,
  getStreamUrl: driveMocks.getStreamUrl,
  getPublishStreamUrl: driveMocks.getPublishStreamUrl,
  getFileMetadata: driveMocks.getFileMetadata,
}));

vi.mock("@/lib/upload-alerts", () => ({
  notifyUploadFailure: alertMocks.notifyUploadFailure,
  notifyUploadSuccess: alertMocks.notifyUploadSuccess,
}));

import { POST } from "../route";

const FILE_ID = "abcdefghijklmnopqrst";

function makeRequest(body: Record<string, unknown>) {
  return {
    headers: { get: () => "Bearer test-token" },
    url: "https://thereach.ten80ten.com/api/drive/finalize",
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
  rateLimitMocks.consume.mockResolvedValue({ allowed: true, remaining: 59, resetAt: new Date() });
  driveMocks.getRootFolderId.mockReturnValue("root-folder");
  driveMocks.ensureSubfolder.mockResolvedValue("raw-folder");
  driveMocks.getStreamUrl.mockReturnValue("/api/drive/stream?id=abcdefghijklmnopqrst");
  driveMocks.getPublishStreamUrl.mockReturnValue("/api/drive/stream?id=abcdefghijklmnopqrst&token=publish");
  driveMocks.getFileMetadata.mockResolvedValue({
    id: FILE_ID,
    name: "clip.mp4",
    mimeType: "video/mp4",
    size: 5 * 1024 * 1024,
    parents: ["raw-folder"],
    appProperties: { workspaceId: "00000000-0000-0000-0000-000000000001" },
  });
  alertMocks.notifyUploadFailure.mockResolvedValue({ emailSent: false, telegramSent: false });
  alertMocks.notifyUploadSuccess.mockResolvedValue({ emailSent: false, telegramSent: false, skipped: false });
});

describe("POST /api/drive/finalize", () => {
  it("resolves only the requested managed folder before returning signed stream URLs", async () => {
    const res = await POST(makeRequest({ fileId: FILE_ID, folder: "raw-files" }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toMatchObject({
      fileId: FILE_ID,
      url: "/api/drive/stream?id=abcdefghijklmnopqrst",
      driveProxyUrl: "/api/drive/stream?id=abcdefghijklmnopqrst",
      publishUrl: "/api/drive/stream?id=abcdefghijklmnopqrst&token=publish",
    });
    expect(driveMocks.ensureSubfolder).toHaveBeenCalledTimes(1);
    expect(driveMocks.ensureSubfolder).toHaveBeenCalledWith("raw-files", "root-folder");
    expect(driveMocks.getStreamUrl).toHaveBeenCalledWith(FILE_ID, "00000000-0000-0000-0000-000000000001");
    expect(driveMocks.getPublishStreamUrl).toHaveBeenCalledWith(FILE_ID, "00000000-0000-0000-0000-000000000001");
  });

  it("rejects a file whose parent is not the requested folder before URL signing", async () => {
    driveMocks.getFileMetadata.mockResolvedValueOnce({
      id: FILE_ID,
      name: "clip.mp4",
      mimeType: "video/mp4",
      size: 5 * 1024 * 1024,
      parents: ["media-library-folder"],
    });

    const res = await POST(makeRequest({ fileId: FILE_ID, folder: "raw-files" }));

    expect(res.status).toBe(403);
    expect(driveMocks.ensureSubfolder).toHaveBeenCalledTimes(1);
    expect(driveMocks.getPublishStreamUrl).not.toHaveBeenCalled();
  });

  it("rejects a managed-folder file tagged to another workspace before URL signing", async () => {
    driveMocks.getFileMetadata.mockResolvedValueOnce({
      id: FILE_ID,
      name: "clip.mp4",
      mimeType: "video/mp4",
      size: 5 * 1024 * 1024,
      parents: ["raw-folder"],
      appProperties: { workspaceId: "workspace-b" },
    });

    const res = await POST(makeRequest({ fileId: FILE_ID, folder: "raw-files" }));
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.error).toMatch(/workspace/i);
    expect(driveMocks.getStreamUrl).not.toHaveBeenCalled();
    expect(driveMocks.getPublishStreamUrl).not.toHaveBeenCalled();
  });

  it("rejects a managed-folder file missing workspace metadata before URL signing", async () => {
    driveMocks.getFileMetadata.mockResolvedValueOnce({
      id: FILE_ID,
      name: "clip.mp4",
      mimeType: "video/mp4",
      size: 5 * 1024 * 1024,
      parents: ["raw-folder"],
    });

    const res = await POST(makeRequest({ fileId: FILE_ID, folder: "raw-files" }));
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.error).toMatch(/workspace ownership/i);
    expect(driveMocks.getStreamUrl).not.toHaveBeenCalled();
    expect(driveMocks.getPublishStreamUrl).not.toHaveBeenCalled();
  });

  it("rejects an invalid folder before Drive metadata or permission calls", async () => {
    const res = await POST(makeRequest({ fileId: FILE_ID, folder: "not-managed" }));

    expect(res.status).toBe(400);
    expect(driveMocks.getFileMetadata).not.toHaveBeenCalled();
    expect(driveMocks.ensureSubfolder).not.toHaveBeenCalled();
    expect(driveMocks.getPublishStreamUrl).not.toHaveBeenCalled();
  });

  it("rejects a malformed fileId before Drive metadata or permission calls", async () => {
    const res = await POST(makeRequest({ fileId: "bad", folder: "raw-files" }));

    expect(res.status).toBe(400);
    expect(driveMocks.getFileMetadata).not.toHaveBeenCalled();
    expect(driveMocks.ensureSubfolder).not.toHaveBeenCalled();
    expect(driveMocks.getPublishStreamUrl).not.toHaveBeenCalled();
  });
});
