// Contract-level tests for POST /api/drive/proxy-upload.

import { NextResponse } from "next/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
  getAccessToken: vi.fn(),
  getStreamUrl: vi.fn(),
  getPublishStreamUrl: vi.fn(),
}));

const alertMocks = vi.hoisted(() => ({
  notifyUploadFailure: vi.fn(),
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
  getAccessToken: driveMocks.getAccessToken,
  getStreamUrl: driveMocks.getStreamUrl,
  getPublishStreamUrl: driveMocks.getPublishStreamUrl,
}));

vi.mock("@/lib/upload-alerts", () => ({
  notifyUploadFailure: alertMocks.notifyUploadFailure,
}));

import { POST } from "../route";

const originalFetch = global.fetch;

function makeRequest(headers: Record<string, string>, formData = new FormData()) {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return {
    headers: { get: (n: string) => lower[n.toLowerCase()] ?? null },
    url: "https://thereach.ten80ten.com/api/drive/proxy-upload",
    formData: () => Promise.resolve(formData),
  } as unknown as Parameters<typeof POST>[0];
}

function makeUploadForm(file = new File(["image"], "hero.jpg", { type: "image/jpeg" })) {
  if (typeof file.arrayBuffer !== "function") {
    Object.defineProperty(file, "arrayBuffer", {
      value: () => Promise.resolve(new TextEncoder().encode("image").buffer),
    });
  }
  const form = new FormData();
  form.append("file", file);
  form.append("folder", "media-library");
  form.append("fileName", file.name);
  form.append("mimeType", file.type);
  return form;
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
  rateLimitMocks.consume.mockResolvedValue({
    allowed: true,
    remaining: 30,
    resetAt: new Date(Date.now() + 30_000),
  });
  driveMocks.getRootFolderId.mockReturnValue("root-folder");
  driveMocks.ensureSubfolder.mockResolvedValue("sub-folder");
  driveMocks.getAccessToken.mockResolvedValue("drive-token");
  driveMocks.getStreamUrl.mockReturnValue("/api/drive/stream?id=file-1");
  driveMocks.getPublishStreamUrl.mockReturnValue("/api/drive/stream?id=file-1&token=publish");
  alertMocks.notifyUploadFailure.mockResolvedValue({ emailSent: false, telegramSent: false });
  global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify({
    id: "file-1",
    mimeType: "image/jpeg",
    size: "5",
  }), { status: 200 }))) as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe("POST /api/drive/proxy-upload", () => {
  it("rejects a request with no Authorization header with 401", async () => {
    authMocks.requireBearerTeamRole.mockResolvedValueOnce(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

    const res = await POST(makeRequest({}));

    expect(res.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("does not return 2xx for any unauthenticated request", async () => {
    authMocks.requireBearerTeamRole.mockResolvedValueOnce(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

    const res = await POST(makeRequest({}));

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects a zero-byte upload before it can create a silent empty Drive file", async () => {
    const empty = new File([], "empty.jpg", { type: "image/jpeg" });
    const form = new FormData();
    form.append("file", empty);
    form.append("folder", "media-library");
    form.append("fileName", "empty.jpg");
    form.append("mimeType", "image/jpeg");

    const res = await POST(makeRequest({ Authorization: "Bearer token" }, form));

    expect(res.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("marks this app's 60/min limiter as appRateLimited and does not call Drive", async () => {
    rateLimitMocks.consume.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: new Date(Date.now() + 30_000),
    });

    const res = await POST(makeRequest({ Authorization: "Bearer token" }, makeUploadForm()));
    const data = await res.json();

    expect(res.status).toBe(429);
    expect(data).toMatchObject({ errorReason: "appRateLimited", retryable: false });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("sanitizes Google Drive quota failures on the proxy path", async () => {
    global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      error: {
        code: 403,
        message: "raw quota details should stay server-side",
        errors: [{ reason: "userRateLimitExceeded", message: "raw quota details should stay server-side" }],
      },
    }), { status: 403 }))) as typeof fetch;

    const res = await POST(makeRequest({ Authorization: "Bearer token" }, makeUploadForm()));
    const data = await res.json();

    expect(res.status).toBe(429);
    expect(data).toMatchObject({ errorReason: "driveRateLimited", retryable: true });
    expect(JSON.stringify(data)).not.toContain("raw quota details");
    expect(alertMocks.notifyUploadFailure).toHaveBeenCalledWith(expect.objectContaining({
      errorMessage: "Storage is busy. Retrying automatically.",
      errorStatus: 403,
      errorDetail: expect.stringContaining("reason=driveRateLimited"),
    }));
    expect(alertMocks.notifyUploadFailure.mock.calls[0]?.[0]?.errorDetail).not.toContain("raw quota details");
  });

  it("tags proxy-uploaded Drive files with the caller workspace and signs the stream URL for that workspace", async () => {
    const res = await POST(makeRequest({ Authorization: "Bearer token" }, makeUploadForm()));

    expect(res.status).toBe(200);
    expect(driveMocks.getStreamUrl).toHaveBeenCalledWith("file-1", "00000000-0000-0000-0000-000000000001");
    expect(driveMocks.getPublishStreamUrl).toHaveBeenCalledWith("file-1", "00000000-0000-0000-0000-000000000001");
    const uploadCall = vi.mocked(global.fetch).mock.calls[0];
    const body = uploadCall?.[1]?.body;
    expect(Buffer.isBuffer(body)).toBe(true);
    expect((body as Buffer).toString("utf8")).toContain('"appProperties":{"workspaceId":"00000000-0000-0000-0000-000000000001"}');
  });
});
