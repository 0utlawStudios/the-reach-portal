import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.hoisted(() => vi.fn());
const createClientMock = vi.hoisted(() => vi.fn(() => ({ rpc: rpcMock })));

vi.mock("@supabase/supabase-js", () => ({
  createClient: createClientMock,
}));

import { recordServerUploadFailure, recordUploadSuccess } from "@/lib/upload-audit";

const WORKSPACE = "00000000-0000-0000-0000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
  rpcMock.mockResolvedValue({ error: null });
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

describe("upload audit persistence", () => {
  it("persists a server failure with the REAL status/reason detail (queryable later)", async () => {
    const ok = await recordServerUploadFailure({
      workspaceId: WORKSPACE,
      phase: "resumable_chunk_session_invalid",
      route: "/api/drive/upload-chunk",
      uploadPath: "resumable",
      fileName: "Draft The Reach Intro .mov",
      mimeType: "video/quicktime",
      fileSize: 98450800,
      errorStatus: 403,
      errorDetail: "status=403 reason=sessionInvalid retryable=false",
      errorMessage: "Your upload session expired or could not be verified. Please retry the upload.",
    });

    expect(ok).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith("record_audit_event", expect.objectContaining({
      p_entity_type: "upload",
      p_action: "upload_failed_server",
      p_workspace_id: WORKSPACE,
      p_metadata: expect.objectContaining({
        error_status: 403,
        error_detail: "status=403 reason=sessionInvalid retryable=false",
        route: "/api/drive/upload-chunk",
      }),
    }));
  });

  it("records a success parity event", async () => {
    const ok = await recordUploadSuccess({
      workspaceId: WORKSPACE,
      fileId: "drive-123",
      fileName: "clip.mov",
      folder: "raw-files",
      mimeType: "video/quicktime",
      fileSize: 65 * 1024 * 1024,
      uploadPath: "resumable",
    });

    expect(ok).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith("record_audit_event", expect.objectContaining({
      p_action: "upload_succeeded",
      p_workspace_id: WORKSPACE,
    }));
  });

  it("never throws and skips persistence for an invalid workspace id", async () => {
    const ok = await recordServerUploadFailure({ workspaceId: "not-a-uuid", errorStatus: 500 });
    expect(ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("returns false (best-effort) when the audit RPC errors, without throwing", async () => {
    rpcMock.mockResolvedValueOnce({ error: { message: "db down" } });
    const ok = await recordUploadSuccess({ workspaceId: WORKSPACE, fileId: "x" });
    expect(ok).toBe(false);
  });
});
