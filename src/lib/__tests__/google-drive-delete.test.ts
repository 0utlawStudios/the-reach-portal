import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Auth is mocked so the Drive helpers can run without real credentials.
vi.mock("google-auth-library", () => ({
  GoogleAuth: class {
    async getClient() {
      return { getAccessToken: async () => ({ token: "test-token" }) };
    }
  },
}));

import {
  getFileMetadataOrNull,
  getSubfolderId,
  removePublicPermissions,
  trashDriveFile,
} from "@/lib/google-drive";
import { extractDriveFileIdFromAppUrl } from "@/lib/drive-url-utils";

const FILE_ID = "abcdefghijklmnopqrstuvwx"; // 24 chars, valid shape
const originalFetch = global.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = Buffer.from(
    JSON.stringify({ client_email: "sa@example.iam.gserviceaccount.com", private_key: "x" }),
  ).toString("base64");
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe("extractDriveFileIdFromAppUrl", () => {
  it("pulls a well-formed id from relative and absolute app stream URLs", () => {
    expect(extractDriveFileIdFromAppUrl(`/api/drive/stream?id=${FILE_ID}`)).toBe(FILE_ID);
    expect(extractDriveFileIdFromAppUrl(`https://thereach.ten80ten.com/api/drive/stream?id=${FILE_ID}&token=abc`)).toBe(FILE_ID);
  });

  it("returns null for missing, malformed, or non-string ids (no arbitrary Drive targeting)", () => {
    expect(extractDriveFileIdFromAppUrl("/api/drive/stream")).toBeNull();
    expect(extractDriveFileIdFromAppUrl("/api/drive/stream?id=short")).toBeNull();
    expect(extractDriveFileIdFromAppUrl("/api/drive/stream?id=../../etc/passwd")).toBeNull();
    expect(extractDriveFileIdFromAppUrl(null)).toBeNull();
    expect(extractDriveFileIdFromAppUrl(123)).toBeNull();
  });
});

describe("trashDriveFile", () => {
  it("moves the file to trash with PATCH trashed:true and never a permanent DELETE", async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method || "GET", body: init?.body });
      return new Response(JSON.stringify({ id: FILE_ID, trashed: true }), { status: 200 });
    }) as typeof fetch;

    await trashDriveFile(FILE_ID);

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].url).toContain(`/files/${FILE_ID}`);
    expect(calls[0].url).toContain("supportsAllDrives=true");
    expect(String(calls[0].body)).toContain('"trashed":true');
    // The SA cannot permanently delete on the Shared Drive — never issue DELETE on the file.
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });
});

describe("getFileMetadataOrNull", () => {
  it("returns null when Drive confirms the file is gone (404) so the row can be cleaned up", async () => {
    global.fetch = vi.fn(async () => new Response("not found", { status: 404 })) as typeof fetch;
    expect(await getFileMetadataOrNull(FILE_ID)).toBeNull();
  });

  it("still throws on a non-404 Drive error (stays fail-closed, keeps the row)", async () => {
    global.fetch = vi.fn(async () => new Response("server boom", { status: 500 })) as typeof fetch;
    await expect(getFileMetadataOrNull(FILE_ID)).rejects.toThrow();
  });

  it("maps the metadata on success", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      id: FILE_ID, name: "clip.mov", mimeType: "video/quicktime", size: "120", parents: ["p1"], appProperties: { workspaceId: "w1" },
    }), { status: 200 })) as typeof fetch;
    const meta = await getFileMetadataOrNull(FILE_ID);
    expect(meta).toMatchObject({ id: FILE_ID, parents: ["p1"], appProperties: { workspaceId: "w1" } });
  });
});

describe("getSubfolderId (read-only)", () => {
  it("returns the existing folder id and never issues a create (POST)", async () => {
    const methods: string[] = [];
    global.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      methods.push(init?.method || "GET");
      return new Response(JSON.stringify({ files: [{ id: "folder-1" }] }), { status: 200 });
    }) as typeof fetch;

    expect(await getSubfolderId("raw-files", "root-read-A")).toBe("folder-1");
    expect(methods.some((m) => m === "POST")).toBe(false);
  });

  it("returns null when the folder does not exist (no folder is created)", async () => {
    const methods: string[] = [];
    global.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      methods.push(init?.method || "GET");
      return new Response(JSON.stringify({ files: [] }), { status: 200 });
    }) as typeof fetch;

    expect(await getSubfolderId("missing-folder", "root-read-B")).toBeNull();
    expect(methods.some((m) => m === "POST")).toBe(false);
  });
});

describe("removePublicPermissions", () => {
  it("removes only the anyone grants and reports the count", async () => {
    const deleted: string[] = [];
    global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method || "GET";
      if (method === "GET") {
        return new Response(JSON.stringify({
          permissions: [
            { id: "perm-anyone", type: "anyone" },
            { id: "perm-user", type: "user" },
          ],
        }), { status: 200 });
      }
      if (method === "DELETE") {
        deleted.push(u);
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected ${method} ${u}`);
    }) as typeof fetch;

    const removed = await removePublicPermissions(FILE_ID);

    expect(removed).toBe(1);
    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toContain("/permissions/perm-anyone");
    expect(deleted[0]).toContain("supportsAllDrives=true");
  });
});
