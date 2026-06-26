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
  posts: [] as Array<Record<string, unknown>>,
  loadError: null as { message: string } | null,
  postsError: null as { message: string } | null,
  deleteError: null as { message: string } | null,
  deletedIds: [] as string[],
  auditCalls: [] as Array<Record<string, unknown>>,
  storageRemovals: [] as string[],
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

function makeBuilder(table: string) {
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
      } else if (table === "posts") {
        resolve({ data: supabaseMocks.postsError ? null : supabaseMocks.posts, error: supabaseMocks.postsError });
      } else {
        resolve({ data: supabaseMocks.loadError ? null : supabaseMocks.rows, error: supabaseMocks.loadError });
      }
    },
  };
  return builder;
}

function makeAdmin() {
  return {
    from: (table: string) => makeBuilder(table),
    rpc: async (_fn: string, args: Record<string, unknown>) => { supabaseMocks.auditCalls.push(args); return { error: null }; },
    storage: { from: () => ({ remove: async (keys: string[]) => { supabaseMocks.storageRemovals.push(...keys); return { error: null }; } }) },
  };
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
  supabaseMocks.posts = [];
  supabaseMocks.loadError = null;
  supabaseMocks.postsError = null;
  supabaseMocks.deleteError = null;
  supabaseMocks.deletedIds = [];
  supabaseMocks.auditCalls = [];
  supabaseMocks.storageRemovals = [];
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
  supabaseMocks.createClient.mockReturnValue(makeAdmin());
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

  it("BLOCKS trashing a file a post still uses (by Drive file id) — keeps the file AND the row", async () => {
    // The library asset and the post's media share the SAME Drive file; trashing it would
    // purge the post's media and revoke its stream auth. Must be refused.
    supabaseMocks.rows = [{ id: ASSET_A, file_id: FILE_ID, url: `/api/drive/stream?id=${FILE_ID}`, drive_proxy_url: null, playback_url: null, folder: "media-library" }];
    supabaseMocks.posts = [{ thumbnail_url: null, source_vault: { rawFiles: [{ fileId: FILE_ID }] }, media_ids: [], asset_urls: [] }];

    const res = await POST(makeRequest([ASSET_A]));
    const data = await res.json();

    expect(data.results[0]).toMatchObject({ status: "failed" });
    expect(data.results[0].error).toMatch(/still used by 1 post/);
    expect(driveMocks.trashDriveFile).not.toHaveBeenCalled();
    expect(driveMocks.removePublicPermissions).not.toHaveBeenCalled();
    expect(supabaseMocks.deletedIds).toEqual([]); // row kept
  });

  it("BLOCKS trashing when a post references the asset by its media_assets UUID", async () => {
    supabaseMocks.rows = [{ id: ASSET_A, file_id: FILE_ID, url: `/api/drive/stream?id=${FILE_ID}`, drive_proxy_url: null, playback_url: null, folder: "media-library" }];
    supabaseMocks.posts = [{ thumbnail_url: null, source_vault: {}, media_ids: [ASSET_A], asset_urls: [] }];

    const res = await POST(makeRequest([ASSET_A]));
    const data = await res.json();

    expect(data.results[0]).toMatchObject({ status: "failed" });
    expect(driveMocks.trashDriveFile).not.toHaveBeenCalled();
    expect(supabaseMocks.deletedIds).toEqual([]);
  });

  it("fail-closed: keeps the asset when the post-usage check cannot load", async () => {
    supabaseMocks.postsError = { message: "transient" };
    supabaseMocks.rows = [{ id: ASSET_A, file_id: FILE_ID, url: `/api/drive/stream?id=${FILE_ID}`, drive_proxy_url: null, playback_url: null, folder: "media-library" }];

    const res = await POST(makeRequest([ASSET_A]));
    const data = await res.json();

    expect(data.results[0]).toMatchObject({ status: "failed" });
    expect(data.results[0].error).toMatch(/Could not verify/);
    expect(driveMocks.trashDriveFile).not.toHaveBeenCalled();
    expect(supabaseMocks.deletedIds).toEqual([]);
  });

  it("allows deleting an UNREFERENCED asset, records an audit row, and removes the playback object", async () => {
    supabaseMocks.rows = [{ id: ASSET_A, file_id: FILE_ID, url: `/api/drive/stream?id=${FILE_ID}`, drive_proxy_url: null, playback_url: null, playback_storage_key: "ws/clip.mp4", folder: "media-library" }];
    supabaseMocks.posts = [{ thumbnail_url: "/api/drive/stream?id=someOtherFile00000000", source_vault: {}, media_ids: [], asset_urls: [] }];

    const res = await POST(makeRequest([ASSET_A]));
    const data = await res.json();

    expect(data.results).toEqual([{ mediaAssetId: ASSET_A, driveFileId: FILE_ID, status: "deleted" }]);
    expect(driveMocks.trashDriveFile).toHaveBeenCalledWith(FILE_ID);
    expect(supabaseMocks.deletedIds).toEqual([ASSET_A]);
    // delete-sync-2: an audit row is written so a mistaken delete can be matched back from trash.
    expect(supabaseMocks.auditCalls).toHaveLength(1);
    expect(supabaseMocks.auditCalls[0]).toMatchObject({ p_action: "media_trashed", p_entity_id: ASSET_A, p_metadata: expect.objectContaining({ drive_file_id: FILE_ID }) });
    // delete-sync-3: the private playback derivative is cleaned up, not orphaned.
    expect(supabaseMocks.storageRemovals).toEqual(["ws/clip.mp4"]);
  });

  it("resolves the Drive id from the authoritative file_id column even when no URL carries ?id=", async () => {
    // delete-sync-4: a playback-optimized video stores only /api/media/playback?key= URLs.
    supabaseMocks.rows = [{ id: ASSET_A, file_id: FILE_ID, url: "/api/media/playback?key=ws/clip.mp4", drive_proxy_url: null, playback_url: "/api/media/playback?key=ws/clip.mp4", folder: "media-library" }];
    const res = await POST(makeRequest([ASSET_A]));
    const data = await res.json();

    expect(data.results).toEqual([{ mediaAssetId: ASSET_A, driveFileId: FILE_ID, status: "deleted" }]);
    expect(driveMocks.trashDriveFile).toHaveBeenCalledWith(FILE_ID);
  });
});
