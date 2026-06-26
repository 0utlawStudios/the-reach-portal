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

import { notifyUploadFailure, notifyUploadSuccess } from "@/lib/upload-alerts";

const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SUCCESS_NOTIFY = process.env.UPLOAD_SUCCESS_NOTIFY;

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
  if (SUCCESS_NOTIFY === undefined) delete process.env.UPLOAD_SUCCESS_NOTIFY; else process.env.UPLOAD_SUCCESS_NOTIFY = SUCCESS_NOTIFY;
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

describe("notifyUploadSuccess (every-upload visibility)", () => {
  it("pings Telegram with the uploader + file on a successful upload (default on)", async () => {
    const result = await notifyUploadSuccess({
      workspaceId: "00000000-0000-0000-0000-000000000001",
      fileName: "Sunset Drone 4K.mov",
      folder: "raw-files",
      mimeType: "video/quicktime",
      fileSize: 250 * 1024 * 1024,
      uploadPath: "resumable",
      userEmail: "creator@thereach.com",
    });

    expect(result.skipped).toBe(false);
    expect(telegramMocks.pingTelegram).toHaveBeenCalledTimes(1);
    const text = telegramMocks.pingTelegram.mock.calls[0][0].text as string;
    expect(text).toContain("succeeded");
    expect(text).toContain("Sunset Drone 4K.mov");
    expect(text).toContain("creator@thereach.com");
  });

  it("is opt-out: UPLOAD_SUCCESS_NOTIFY=false silences successes (failures unaffected)", async () => {
    process.env.UPLOAD_SUCCESS_NOTIFY = "false";
    const result = await notifyUploadSuccess({ workspaceId: "00000000-0000-0000-0000-000000000001", fileName: "x.jpg" });

    expect(result.skipped).toBe(true);
    expect(telegramMocks.pingTelegram).not.toHaveBeenCalled();
  });
});
