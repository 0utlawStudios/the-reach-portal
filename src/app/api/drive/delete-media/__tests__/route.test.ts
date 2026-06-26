import { NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({ requireBearerTeamRole: vi.fn() }));
const rateLimitMocks = vi.hoisted(() => ({ consume: vi.fn(), getClientIp: vi.fn() }));
const driveMocks = vi.hoisted(() => ({
  getRootFolderId: vi.fn(),
  getSubfolderId: vi.fn(),
  getFileMetadataOrNull: vi.fn(),
  removePublicPermissions: vi.fn(),
  trashDriveFile: vi.fn(),
}));
const supabaseMocks = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  loadError: null as { message: string } | null,
  deleteError: null as { message: string } | null,
  deletedIds: [] as string[],
  createClient: vi.fn(),
}));

vi.mock("@/lib/auth/require", () => ({ requireBearerTeamRole: authMocks.requireBearerTeamRole }));
vi.mock("@/lib/rate-limit", () => ({ consume: rateLimitMocks.consume, getClientIp: rateLimitMocks.getClientIp }));
vi.mock("@/lib/google-drive", () => ({
  getRootFolderId: driveMocks.getRootFolderId,
  getSubfolderId: driveMocks.getSubfolderId,
  getFileMetadataOrNull: driveMocks.getFileMetadataOrNull,
  removePublicPermissions: driveMocks.removePublicPermissions,
  trashDriveFile: driveMocks.trashDriveFile,
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: supabaseMocks.createClient }));

import { POST } from "../route";

const WORKSPACE = "00000000-0000-0000-0000-000000000001";
const FILE_ID = "abcdefghijklmnopqrstuvwx";
const ASSET_A = "11111111-1111-4111-8111-111111111111";
const ASSET_B = "22222222-2222-4222-8222-222222222222";
const order: string[] = [];

function makeBuilder() {
  let isDelete = false;
  let deleteId = "";
  const builder: Record<string, unknown> = {
    select: () => builder,
    in: () => builder,
    eq: (col: string, val: string) => { if (isDelete && col === "id") deleteId = val; return builder; },
    delete: () => { isDelete = true; return builder; },
    then: (resolve: (v: unknown) => void) => {
      if (isDelete) {
        if (!supabaseMocks.deleteError) supabaseMocks.deletedIds.push(deleteId);
        resolve({ error: supabaseMocks.deleteError });
      } else {
        resolve({ data: supabaseMocks.loadError ? null : supabaseMocks.rows, error: supabaseMocks.loadError });
      }
    },
  };
  return builder;
}

function makeRequest(mediaAssetIds: unknown) {
  return {
    headers: { get: () => "Bearer token" },
    url: "https://thereach.ten80ten.com/api/drive/delete-media",
    json: () => Promise.resolve({ mediaAssetIds }),
  } as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  order.length = 0;
  supabaseMocks.rows = [];
  supabaseMocks.loadError = null;
  supabaseMocks.deleteError = null;
  supabaseMocks.deletedIds = [];
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
  authMocks.requireBearerTeamRole.mockResolvedValue({ user: { id: "user-1" }, email: "c@e.com", role: "editor", workspaceId: WORKSPACE });
  rateLimitMocks.getClientIp.mockReturnValue("1.2.3.4");
  rateLimitMocks.consume.mockResolvedValue({ allowed: true, remaining: 60, resetAt: new Date() });
  driveMocks.getRootFolderId.mockReturnValue("root");
  driveMocks.getSubfolderId.mockImplementation(async (folder: string) => `parent-${folder}`);
  driveMocks.getFileMetadataOrNull.mockResolvedValue({ parents: ["parent-media-library"], appProperties: { workspaceId: WORKSPACE }, size: 10, name: "x", mimeType: "image/jpeg" });
  driveMocks.removePublicPermissions.mockImplementation(async () => { order.push("removePerms"); return 1; });
  driveMocks.trashDriveFile.mockImplementation(async () => { order.push("trash"); });
  supabaseMocks.createClient.mockReturnValue({ from: () => makeBuilder() });
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

describe("POST /api/drive/delete-media", () => {
  it("rejects an unauthenticated caller", async () => {
    authMocks.requireBearerTeamRole.mockResolvedValueOnce(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    const res = await POST(makeRequest([ASSET_A]));
    expect(res.status).toBe(401);
    expect(driveMocks.trashDriveFile).not.toHaveBeenCalled();
  });

  it("rejects a request with no valid media asset IDs", async () => {
    const res = await POST(makeRequest(["not-a-uuid", 123]));
    expect(res.status).toBe(400);
    expect(driveMocks.trashDriveFile).not.toHaveBeenCalled();
  });

  it("trashes (not deletes) the Drive file then removes the row, stripping public access first", async () => {
    supabaseMocks.rows = [{ id: ASSET_A, url: `/api/drive/stream?id=${FILE_ID}`, drive_proxy_url: null, playback_url: null, folder: "media-library" }];
    const res = await POST(makeRequest([ASSET_A]));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.results).toEqual([{ mediaAssetId: ASSET_A, driveFileId: FILE_ID, status: "deleted" }]);
    expect(driveMocks.trashDriveFile).toHaveBeenCalledWith(FILE_ID);
    expect(order).toEqual(["removePerms", "trash"]); // public access stripped BEFORE trash
    expect(supabaseMocks.deletedIds).toEqual([ASSET_A]); // DB row removed only after Drive cleanup
  });

  it("keeps the row when the Drive file is not in an app-managed folder", async () => {
    driveMocks.getFileMetadataOrNull.mockResolvedValueOnce({ parents: ["some-other-folder"], appProperties: { workspaceId: WORKSPACE }, size: 10, name: "x", mimeType: "image/jpeg" });
    supabaseMocks.rows = [{ id: ASSET_A, url: `/api/drive/stream?id=${FILE_ID}`, drive_proxy_url: null, playback_url: null, folder: "media-library" }];

    const res = await POST(makeRequest([ASSET_A]));
    const data = await res.json();

    expect(data.results[0]).toMatchObject({ status: "failed" });
    expect(driveMocks.trashDriveFile).not.toHaveBeenCalled();
    expect(supabaseMocks.deletedIds).toEqual([]); // row kept (fail-closed)
  });

  it("deletes the stale DB row when the Drive file is already gone (404), instead of orphaning it forever", async () => {
    // getFileMetadataOrNull returns null only on a confirmed Drive 404. Nothing to trash —
    // the row must still be removed so the asset stops reappearing as an undeletable orphan.
    driveMocks.getFileMetadataOrNull.mockResolvedValueOnce(null);
    supabaseMocks.rows = [{ id: ASSET_A, url: `/api/drive/stream?id=${FILE_ID}`, drive_proxy_url: null, playback_url: null, folder: "media-library" }];

    const res = await POST(makeRequest([ASSET_A]));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.results).toEqual([{ mediaAssetId: ASSET_A, driveFileId: FILE_ID, status: "deleted" }]);
    expect(driveMocks.trashDriveFile).not.toHaveBeenCalled();
    expect(driveMocks.removePublicPermissions).not.toHaveBeenCalled();
    expect(supabaseMocks.deletedIds).toEqual([ASSET_A]); // stale row cleaned up
  });

  it("caps the batch at MAX_DELETE_BATCH and reports overflow as failed (not silently dropped)", async () => {
    const manyIds = Array.from({ length: 26 }, (_, i) => `000000${i.toString(16).padStart(2, "0")}-0000-4000-8000-000000000000`);
    supabaseMocks.rows = []; // none loaded; focus is on the overflow accounting
    const res = await POST(makeRequest(manyIds));
    const data = await res.json();

    expect(res.status).toBe(200);
    // Every id is accounted for: 25 processed (not-found here) + 1 overflow, none dropped.
    expect(data.results).toHaveLength(26);
    const overflow = data.results.filter((r: { error?: string }) => /batches of 25/.test(r.error || ""));
    expect(overflow).toHaveLength(1);
  });

  it("keeps the row and does not lie when Drive trash fails", async () => {
    driveMocks.trashDriveFile.mockRejectedValueOnce(new Error("raw Google insufficientFilePermissions detail"));
    supabaseMocks.rows = [{ id: ASSET_A, url: `/api/drive/stream?id=${FILE_ID}`, drive_proxy_url: null, playback_url: null, folder: "media-library" }];

    const res = await POST(makeRequest([ASSET_A]));
    const data = await res.json();

    expect(data.results[0]).toMatchObject({ status: "failed" });
    expect(JSON.stringify(data)).not.toContain("raw Google");
    expect(supabaseMocks.deletedIds).toEqual([]);
  });

  it("reports a requested asset that is not in the caller's workspace as failed (so the UI restores it)", async () => {
    supabaseMocks.rows = []; // none loaded for this workspace
    const res = await POST(makeRequest([ASSET_B]));
    const data = await res.json();

    expect(data.results).toEqual([{ mediaAssetId: ASSET_B, driveFileId: null, status: "failed", error: "Media asset not found in your workspace" }]);
    expect(driveMocks.trashDriveFile).not.toHaveBeenCalled();
  });

  it("fails an asset whose URL has no resolvable Drive ID without trashing anything", async () => {
    supabaseMocks.rows = [{ id: ASSET_A, url: "/api/drive/stream", drive_proxy_url: null, playback_url: null, folder: "media-library" }];
    const res = await POST(makeRequest([ASSET_A]));
    const data = await res.json();

    expect(data.results[0]).toMatchObject({ status: "failed" });
    expect(driveMocks.trashDriveFile).not.toHaveBeenCalled();
    expect(supabaseMocks.deletedIds).toEqual([]);
  });
});
