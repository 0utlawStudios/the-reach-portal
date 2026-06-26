import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sharedMocks = vi.hoisted(() => ({
  requireNotificationContext: vi.fn(),
  loadCallerProfile: vi.fn(),
}));

const alertMocks = vi.hoisted(() => ({
  notifyUploadFailure: vi.fn(),
}));

const rateLimitMocks = vi.hoisted(() => ({
  consume: vi.fn(),
  getClientIp: vi.fn(),
}));

const adminMocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("@/app/api/notifications/_shared", () => ({
  requireNotificationContext: sharedMocks.requireNotificationContext,
  loadCallerProfile: sharedMocks.loadCallerProfile,
}));

vi.mock("@/lib/upload-alerts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/upload-alerts")>();
  return {
    ...actual,
    notifyUploadFailure: alertMocks.notifyUploadFailure,
  };
});

vi.mock("@/lib/rate-limit", () => ({
  consume: rateLimitMocks.consume,
  getClientIp: rateLimitMocks.getClientIp,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: adminMocks.createClient,
}));

import { POST } from "../route";

function makeRequest(body: Record<string, unknown>) {
  return {
    headers: { get: (name: string) => name === "user-agent" ? "vitest-agent" : null },
    url: "https://thereach.ten80ten.com/api/drive/upload-failure",
    json: () => Promise.resolve(body),
  } as Parameters<typeof POST>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  sharedMocks.requireNotificationContext.mockResolvedValue({
    user: { id: "user-1" },
    email: "creator@example.com",
    role: "editor",
    workspaceId: "00000000-0000-0000-0000-000000000001",
  });
  sharedMocks.loadCallerProfile.mockResolvedValue({ name: "Creator", email: "creator@example.com" });
  alertMocks.notifyUploadFailure.mockResolvedValue({ emailSent: true, telegramSent: true });
  rateLimitMocks.consume.mockResolvedValue({ allowed: true, remaining: 29, resetAt: new Date() });
  rateLimitMocks.getClientIp.mockReturnValue("1.2.3.4");
  adminMocks.rpc.mockResolvedValue({ data: null, error: null });
  adminMocks.createClient.mockReturnValue({ rpc: adminMocks.rpc });
});

describe("POST /api/drive/upload-failure", () => {
  it("sends an owner alert and audits with trusted caller context", async () => {
    const res = await POST(makeRequest({
      phase: "media_library_batch_upload",
      uploadPath: "proxy",
      cardId: "11111111-1111-4111-8111-111111111111",
      postTitle: "Launch Reel",
      folder: "media-library",
      fileName: "hero.png",
      mimeType: "image/png",
      fileSize: 2048,
      errorMessage: "Upload timed out",
    }));

    expect(res.status).toBe(200);
    expect(alertMocks.notifyUploadFailure).toHaveBeenCalledWith(expect.objectContaining({
      source: "client",
      workspaceId: "00000000-0000-0000-0000-000000000001",
      userId: "user-1",
      userEmail: "creator@example.com",
      userRole: "editor",
      cardId: "11111111-1111-4111-8111-111111111111",
      fileName: "hero.png",
      errorMessage: "Upload timed out",
    }));
    expect(adminMocks.rpc).toHaveBeenCalledWith("record_audit_event", expect.objectContaining({
      p_entity_type: "upload",
      p_action: "upload_failed_alerted",
      p_entity_id: "11111111-1111-4111-8111-111111111111",
      p_workspace_id: "00000000-0000-0000-0000-000000000001",
    }));
  });

  it("redacts Bearer tokens and secrets from the persisted audit error field", async () => {
    const res = await POST(makeRequest({
      phase: "resumable_chunk",
      errorMessage: "Authorization failed: Bearer sk-secret-abc123",
      errorDetail: "token=supersecret&password=hunter2",
    }));

    expect(res.status).toBe(200);
    const auditCall = adminMocks.rpc.mock.calls.find(
      ([name]: [string]) => name === "record_audit_event",
    );
    expect(auditCall).toBeDefined();
    const metadata = auditCall![1].p_metadata as Record<string, unknown>;
    expect(metadata.error).not.toMatch(/sk-secret-abc123/);
    expect(metadata.error).toContain("[redacted]");
  });

  it("rejects unauthenticated failure reports", async () => {
    sharedMocks.requireNotificationContext.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

    const res = await POST(makeRequest({ errorMessage: "Upload failed" }));

    expect(res.status).toBe(401);
    expect(alertMocks.notifyUploadFailure).not.toHaveBeenCalled();
  });
});
