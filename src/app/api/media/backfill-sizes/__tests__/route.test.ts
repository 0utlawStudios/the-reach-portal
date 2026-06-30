import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({ requireBearerTeamRole: vi.fn() }));
const driveMocks = vi.hoisted(() => ({ getFileMetadata: vi.fn(), getRootFolderId: vi.fn(), getSubfolderId: vi.fn() }));
const supabaseMocks = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  selectError: null as { message: string } | null,
  updateError: null as { message: string } | null,
  updates: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/auth/require", () => ({ requireBearerTeamRole: authMocks.requireBearerTeamRole }));
vi.mock("@/lib/google-drive", () => ({
  getFileMetadata: driveMocks.getFileMetadata,
  getRootFolderId: driveMocks.getRootFolderId,
  getSubfolderId: driveMocks.getSubfolderId,
}));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => makeAdmin() }));

import { POST } from "../route";

const WORKSPACE = "00000000-0000-4000-8000-000000000001";
const BASELINE_WORKSPACE = "00000000-0000-0000-0000-000000000001";
const ASSET_ID = "11111111-1111-4111-8111-111111111111";
const FILE_ID = "abcdefghijklmnopqrstuvwx";

function makeAdmin() {
  return {
    from: () => {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        not: () => builder,
        or: () => builder,
        limit: () => builder,
        in: () => builder,
        update: (payload: Record<string, unknown>) => {
          supabaseMocks.updates.push(payload);
          return {
            eq: () => ({
              eq: () => ({
                select: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: ASSET_ID,
                      name: payload.name || "Untitled asset",
                      mime_type: payload.mime_type || "image/jpeg",
                      size_bytes: payload.size_bytes,
                    },
                    error: supabaseMocks.updateError,
                  }),
                }),
              }),
            }),
          };
        },
        then: (resolve: (value: unknown) => void) => {
          resolve({ data: supabaseMocks.rows, error: supabaseMocks.selectError });
        },
      };
      return builder;
    },
  };
}

function makeRequest(mediaAssetIds: unknown = [ASSET_ID]) {
  return new NextRequest("https://thereach.ten80ten.com/api/media/backfill-sizes", {
    method: "POST",
    headers: { Authorization: "Bearer token", "Content-Type": "application/json", "X-Workspace-Id": WORKSPACE },
    body: JSON.stringify({ mediaAssetIds }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  supabaseMocks.rows = [{
    id: ASSET_ID,
    name: "Untitled asset",
    file_id: FILE_ID,
    mime_type: null,
    size_bytes: null,
  }];
  supabaseMocks.selectError = null;
  supabaseMocks.updateError = null;
  supabaseMocks.updates = [];
  authMocks.requireBearerTeamRole.mockResolvedValue({ user: { id: "user-1" }, email: "a@example.com", role: "editor", workspaceId: WORKSPACE });
  driveMocks.getRootFolderId.mockReturnValue("root-folder");
  driveMocks.getSubfolderId.mockImplementation(async (folder: string) => `parent-${folder}`);
  driveMocks.getFileMetadata.mockResolvedValue({
    id: FILE_ID,
    name: "hero.jpg",
    mimeType: "image/jpeg",
    size: 123456,
    parents: [],
    appProperties: { workspaceId: WORKSPACE },
    thumbnailLink: "",
  });
});

describe("POST /api/media/backfill-sizes", () => {
  it("repairs missing media size from same-workspace Drive metadata", async () => {
    const res = await POST(makeRequest());
    const body = await res.json() as { updated: number; results: Array<{ sizeBytes?: number; name?: string; mimeType?: string }> };

    expect(res.status).toBe(200);
    expect(body.updated).toBe(1);
    expect(body.results[0]).toMatchObject({ sizeBytes: 123456, name: "hero.jpg", mimeType: "image/jpeg" });
    expect(supabaseMocks.updates[0]).toMatchObject({
      size_bytes: 123456,
      name: "hero.jpg",
      mime_type: "image/jpeg",
    });
  });

  it("derives and persists a missing file_id from the stored Drive stream URL", async () => {
    supabaseMocks.rows = [{
      id: ASSET_ID,
      name: "Untitled asset",
      url: `/api/drive/stream?id=${FILE_ID}`,
      file_id: null,
      mime_type: null,
      size_bytes: null,
    }];

    const res = await POST(makeRequest());
    const body = await res.json() as { updated: number };

    expect(res.status).toBe(200);
    expect(body.updated).toBe(1);
    expect(supabaseMocks.updates[0]).toMatchObject({
      file_id: FILE_ID,
      size_bytes: 123456,
    });
  });

  it("repairs baseline legacy files when the Drive parent is app-managed", async () => {
    authMocks.requireBearerTeamRole.mockResolvedValueOnce({ user: { id: "user-1" }, email: "a@example.com", role: "editor", workspaceId: BASELINE_WORKSPACE });
    driveMocks.getFileMetadata.mockResolvedValueOnce({
      id: FILE_ID,
      name: "legacy.jpg",
      mimeType: "image/jpeg",
      size: 345678,
      parents: ["parent-media-library"],
      appProperties: {},
      thumbnailLink: "",
    });

    const res = await POST(makeRequest());
    const body = await res.json() as { updated: number; results: Array<{ sizeBytes?: number; name?: string }> };

    expect(res.status).toBe(200);
    expect(body.updated).toBe(1);
    expect(body.results[0]).toMatchObject({ sizeBytes: 345678, name: "legacy.jpg" });
    expect(supabaseMocks.updates[0]).toMatchObject({
      size_bytes: 345678,
      name: "legacy.jpg",
    });
  });

  it("does not trust untagged files outside the baseline workspace", async () => {
    driveMocks.getFileMetadata.mockResolvedValueOnce({
      id: FILE_ID,
      name: "untagged.jpg",
      mimeType: "image/jpeg",
      size: 999,
      parents: ["parent-media-library"],
      appProperties: {},
      thumbnailLink: "",
    });

    const res = await POST(makeRequest());
    const body = await res.json() as { skipped: number; results: Array<{ status: string; reason?: string }> };

    expect(res.status).toBe(200);
    expect(body.skipped).toBe(1);
    expect(body.results[0].status).toBe("skipped");
    expect(body.results[0].reason).toContain("not trusted");
    expect(supabaseMocks.updates).toEqual([]);
  });

  it("does not trust baseline legacy files outside app-managed Drive folders", async () => {
    authMocks.requireBearerTeamRole.mockResolvedValueOnce({ user: { id: "user-1" }, email: "a@example.com", role: "editor", workspaceId: BASELINE_WORKSPACE });
    driveMocks.getFileMetadata.mockResolvedValueOnce({
      id: FILE_ID,
      name: "outside.jpg",
      mimeType: "image/jpeg",
      size: 999,
      parents: ["outside-parent"],
      appProperties: {},
      thumbnailLink: "",
    });

    const res = await POST(makeRequest());
    const body = await res.json() as { skipped: number; results: Array<{ status: string; reason?: string }> };

    expect(res.status).toBe(200);
    expect(body.skipped).toBe(1);
    expect(body.results[0].status).toBe("skipped");
    expect(body.results[0].reason).toContain("not trusted");
    expect(supabaseMocks.updates).toEqual([]);
  });

  it("does not copy metadata from a Drive file tagged to another workspace", async () => {
    driveMocks.getFileMetadata.mockResolvedValueOnce({
      id: FILE_ID,
      name: "foreign.jpg",
      mimeType: "image/jpeg",
      size: 999,
      parents: [],
      appProperties: { workspaceId: "22222222-2222-4222-8222-222222222222" },
      thumbnailLink: "",
    });

    const res = await POST(makeRequest());
    const body = await res.json() as { skipped: number; results: Array<{ status: string; reason?: string }> };

    expect(res.status).toBe(200);
    expect(body.skipped).toBe(1);
    expect(body.results[0].status).toBe("skipped");
    expect(body.results[0].reason).toContain("not trusted");
    expect(supabaseMocks.updates).toEqual([]);
  });

  it("returns the auth response when the caller cannot read media", async () => {
    authMocks.requireBearerTeamRole.mockResolvedValueOnce(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

    const res = await POST(makeRequest());

    expect(res.status).toBe(401);
    expect(driveMocks.getFileMetadata).not.toHaveBeenCalled();
  });
});
