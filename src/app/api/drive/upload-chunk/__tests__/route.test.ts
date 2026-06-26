import { NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DRIVE_RESUMABLE_CHUNK_SIZE } from "@/lib/drive-policy";
import { signDriveUploadSession } from "@/lib/drive-upload-session";

const authMocks = vi.hoisted(() => ({
  requireBearerTeamRole: vi.fn(),
}));

const rateLimitMocks = vi.hoisted(() => ({
  consume: vi.fn(),
  getClientIp: vi.fn(),
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

vi.mock("@/lib/upload-alerts", () => ({
  notifyUploadFailure: alertMocks.notifyUploadFailure,
}));

import { POST } from "../route";

const originalFetch = global.fetch;
const originalServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const originalUploadSecret = process.env.DRIVE_UPLOAD_SESSION_SECRET;
const uploadUri = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=test-upload";
const workspaceId = "00000000-0000-0000-0000-000000000001";
const userId = "user-1";

function uploadToken(overrides: Partial<Parameters<typeof signDriveUploadSession>[0]> = {}) {
  return signDriveUploadSession({
    uploadUri,
    workspaceId,
    userId,
    folder: "media-library",
    fileSize: 4,
    ...overrides,
  });
}

function makeRequest({
  body = new Uint8Array([1, 2, 3, 4]),
  headers = {},
}: {
  body?: Uint8Array;
  headers?: Record<string, string>;
} = {}) {
  const h = new Headers({
    authorization: "Bearer token",
    "content-type": "image/png",
    "content-range": `bytes 0-${body.byteLength - 1}/${body.byteLength}`,
    "x-upload-uri": uploadUri,
    "x-file-name": "hero.png",
    "x-drive-folder": "media-library",
    ...headers,
  });
  return {
    headers: { get: (name: string) => h.get(name) },
    url: "https://thereach.ten80ten.com/api/drive/upload-chunk",
    arrayBuffer: () => Promise.resolve(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)),
  } as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  authMocks.requireBearerTeamRole.mockResolvedValue({
    user: { id: userId },
    email: "creator@example.com",
    role: "editor",
    workspaceId,
  });
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-upload-session-secret";
  process.env.DRIVE_UPLOAD_SESSION_SECRET = "test-upload-session-secret";
  rateLimitMocks.getClientIp.mockReturnValue("1.2.3.4");
  rateLimitMocks.consume.mockResolvedValue({ allowed: true, remaining: 240, resetAt: new Date() });
  alertMocks.notifyUploadFailure.mockResolvedValue({ emailSent: false, telegramSent: false });
  global.fetch = vi.fn(() => Promise.resolve(Response.json({
    id: "drive-file-1",
    mimeType: "image/png",
    size: "4",
  }))) as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
  if (originalServiceKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceKey;
  if (originalUploadSecret === undefined) delete process.env.DRIVE_UPLOAD_SESSION_SECRET;
  else process.env.DRIVE_UPLOAD_SESSION_SECRET = originalUploadSecret;
});

describe("POST /api/drive/upload-chunk", () => {
  it("rejects requests without a bearer role", async () => {
    authMocks.requireBearerTeamRole.mockResolvedValueOnce(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

    const res = await POST(makeRequest());

    expect(res.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects arbitrary upload session URLs before reading Drive", async () => {
    const res = await POST(makeRequest({
      headers: { "x-upload-uri": "https://example.com/upload" },
    }));

    expect(res.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects a missing upload session token as sessionInvalid, not a fake storage error", async () => {
    const res = await POST(makeRequest());
    const data = await res.json();

    expect(res.status).toBe(403);
    // ROOT-CAUSE REGRESSION: this 403 must NOT collapse into the generic
    // "Storage rejected the upload." It is a session/token failure and must say so.
    expect(data).toMatchObject({ errorReason: "sessionInvalid", retryable: false });
    expect(JSON.stringify(data)).not.toContain("Storage rejected");
    expect(global.fetch).not.toHaveBeenCalled();
    // Previously this 403 path was silent. It must now be observable.
    expect(alertMocks.notifyUploadFailure).toHaveBeenCalledWith(expect.objectContaining({
      route: "/api/drive/upload-chunk",
      phase: "resumable_chunk_session_invalid",
      errorStatus: 403,
      errorDetail: expect.stringContaining("reason=sessionInvalid"),
    }));
  });

  it("rejects a cross-workspace upload session token as sessionInvalid", async () => {
    const res = await POST(makeRequest({
      headers: { "x-upload-token": uploadToken({ workspaceId: "11111111-1111-4111-8111-111111111111" }) },
    }));
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data).toMatchObject({ errorReason: "sessionInvalid", retryable: false });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects chunks over the safe per-request size", async () => {
    const body = new Uint8Array(DRIVE_RESUMABLE_CHUNK_SIZE + 1);

	    const res = await POST(makeRequest({
	      body,
	      headers: {
	        "content-range": `bytes 0-${body.byteLength - 1}/${body.byteLength}`,
	        "x-upload-token": uploadToken({ fileSize: body.byteLength }),
	      },
	    }));

    expect(res.status).toBe(413);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("forwards a chunk to Google and maps 308 to a same-origin incomplete response", async () => {
    global.fetch = vi.fn(() => Promise.resolve(new Response(null, {
      status: 308,
      headers: { Range: "bytes=0-3" },
    }))) as typeof fetch;

	    const res = await POST(makeRequest({
	      body: new Uint8Array([1, 2, 3, 4]),
	      headers: {
	        "content-range": "bytes 0-3/8",
	        "x-upload-token": uploadToken({ fileSize: 8 }),
	      },
	    }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toEqual({ done: false, range: "bytes=0-3" });
    expect(global.fetch).toHaveBeenCalledWith(uploadUri, expect.objectContaining({
      method: "PUT",
      headers: expect.objectContaining({
        "Content-Type": "image/png",
        "Content-Length": "4",
        "Content-Range": "bytes 0-3/8",
      }),
    }));
  });

  it("returns the final Drive file id when Google completes the resumable upload", async () => {
	    const res = await POST(makeRequest({
	      headers: { "x-upload-token": uploadToken() },
	    }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toMatchObject({
      done: true,
      fileId: "drive-file-1",
      mimeType: "image/png",
      size: 4,
    });
  });

  it("sanitizes Google quota failures from chunk upload", async () => {
    global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      error: {
        code: 403,
        message: "raw quota detail",
        errors: [{ reason: "userRateLimitExceeded", message: "raw quota detail" }],
      },
    }), { status: 403 }))) as typeof fetch;

	    const res = await POST(makeRequest({
	      headers: { "x-upload-token": uploadToken() },
	    }));
    const data = await res.json();

    expect(res.status).toBe(429);
    expect(data).toMatchObject({ errorReason: "driveRateLimited", retryable: true });
    expect(JSON.stringify(data)).not.toContain("raw quota detail");
    expect(alertMocks.notifyUploadFailure).toHaveBeenCalledWith(expect.objectContaining({
      route: "/api/drive/upload-chunk",
      errorMessage: "Storage is busy. Retrying automatically.",
      errorStatus: 403,
      errorDetail: expect.stringContaining("reason=driveRateLimited"),
    }));
    expect(alertMocks.notifyUploadFailure.mock.calls[0]?.[0]?.errorDetail).not.toContain("raw quota detail");
  });
});
