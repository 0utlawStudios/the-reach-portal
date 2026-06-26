import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auditMocks = vi.hoisted(() => ({ recordServerUploadFailure: vi.fn() }));
const telegramMocks = vi.hoisted(() => ({ pingTelegram: vi.fn(), tgEscape: (s: string) => s }));

vi.mock("@/lib/upload-audit", () => ({
  recordServerUploadFailure: auditMocks.recordServerUploadFailure,
}));
vi.mock("@/lib/support/telegram", () => ({
  pingTelegram: telegramMocks.pingTelegram,
  tgEscape: telegramMocks.tgEscape,
}));

import { notifyUploadFailure } from "@/lib/upload-alerts";

const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;

beforeEach(() => {
  vi.clearAllMocks();
  // No SMTP env => email path is skipped, isolating the persistence branch.
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  auditMocks.recordServerUploadFailure.mockResolvedValue(true);
  telegramMocks.pingTelegram.mockResolvedValue(false);
});

afterEach(() => {
  if (SMTP_USER === undefined) delete process.env.SMTP_USER; else process.env.SMTP_USER = SMTP_USER;
  if (SMTP_PASS === undefined) delete process.env.SMTP_PASS; else process.env.SMTP_PASS = SMTP_PASS;
});

describe("notifyUploadFailure persistence", () => {
  it("persists a server-side failure with the real error detail", async () => {
    const result = await notifyUploadFailure({
      source: "server",
      phase: "resumable_chunk_session_invalid",
      route: "/api/drive/upload-chunk",
      uploadPath: "resumable",
      workspaceId: "00000000-0000-0000-0000-000000000001",
      errorMessage: "Your upload session expired or could not be verified. Please retry the upload.",
      errorStatus: 403,
      errorDetail: "status=403 reason=sessionInvalid retryable=false",
    });

    expect(result.persisted).toBe(true);
    expect(auditMocks.recordServerUploadFailure).toHaveBeenCalledWith(expect.objectContaining({
      route: "/api/drive/upload-chunk",
      errorStatus: 403,
      errorDetail: "status=403 reason=sessionInvalid retryable=false",
    }));
  });

  it("does NOT double-persist a client-reported failure (the client route audits those)", async () => {
    const result = await notifyUploadFailure({
      source: "client",
      phase: "client_upload",
      workspaceId: "00000000-0000-0000-0000-000000000001",
      errorMessage: "Network error during upload.",
    });

    expect(result.persisted).toBe(false);
    expect(auditMocks.recordServerUploadFailure).not.toHaveBeenCalled();
  });
});
