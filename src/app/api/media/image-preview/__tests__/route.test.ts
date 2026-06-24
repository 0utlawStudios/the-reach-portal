import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const driveMocks = vi.hoisted(() => ({
  ensureSubfolder: vi.fn(),
  getAccessToken: vi.fn(),
  getFileMetadata: vi.fn(),
  getRootFolderId: vi.fn(),
  verifyDriveStreamToken: vi.fn(),
}));

const sharpMocks = vi.hoisted(() => {
  const pipeline: {
    rotate: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
    jpeg: ReturnType<typeof vi.fn>;
    toBuffer: ReturnType<typeof vi.fn>;
  } = {} as {
    rotate: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
    jpeg: ReturnType<typeof vi.fn>;
    toBuffer: ReturnType<typeof vi.fn>;
  };
  pipeline.rotate = vi.fn(() => pipeline);
  pipeline.resize = vi.fn(() => pipeline);
  pipeline.jpeg = vi.fn(() => pipeline);
  pipeline.toBuffer = vi.fn();
  const sharp = vi.fn(() => pipeline) as unknown as ReturnType<typeof vi.fn> & {
    format: { heif: { input: { buffer: boolean } } };
  };
  sharp.format = { heif: { input: { buffer: true } } };
  return { sharp, pipeline };
});

vi.mock("@/lib/google-drive", () => ({
  ensureSubfolder: driveMocks.ensureSubfolder,
  getAccessToken: driveMocks.getAccessToken,
  getFileMetadata: driveMocks.getFileMetadata,
  getRootFolderId: driveMocks.getRootFolderId,
  verifyDriveStreamToken: driveMocks.verifyDriveStreamToken,
}));

vi.mock("sharp", () => ({
  default: sharpMocks.sharp,
}));

import { GET } from "../route";

const FILE_ID = "abcdefghijklmnopqrst";
const originalFetch = globalThis.fetch;

function makeRequest(path = `/api/media/image-preview?id=${FILE_ID}&token=signed`) {
  return new NextRequest(`http://localhost:3000${path}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  driveMocks.verifyDriveStreamToken.mockReturnValue(true);
  driveMocks.getFileMetadata.mockResolvedValue({
    id: FILE_ID,
    name: "source.heic",
    mimeType: "image/heic",
    size: 2 * 1024 * 1024,
    parents: ["raw-files-folder"],
  });
  driveMocks.getAccessToken.mockResolvedValue("drive-token");
  sharpMocks.pipeline.toBuffer.mockResolvedValue(Buffer.from([0xff, 0xd8, 0xff]));
  globalThis.fetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("GET /api/media/image-preview", () => {
  it("converts a signed HEIC Drive file to a browser-safe JPEG response", async () => {
    const res = await GET(makeRequest());
    const body = new Uint8Array(await res.arrayBuffer());

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toBe("public, max-age=86400, immutable");
    expect(Array.from(body)).toEqual([0xff, 0xd8, 0xff]);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining(`/files/${FILE_ID}?alt=media`),
      expect.objectContaining({
        headers: { Authorization: "Bearer drive-token" },
      }),
    );
    expect(sharpMocks.pipeline.resize).toHaveBeenCalledWith(expect.objectContaining({
      fit: "inside",
      withoutEnlargement: true,
    }));
  });

  it("rejects non-HEIC images instead of proxying arbitrary Drive files", async () => {
    driveMocks.getFileMetadata.mockResolvedValueOnce({
      id: FILE_ID,
      name: "cover.jpg",
      mimeType: "image/jpeg",
      size: 1000,
      parents: ["raw-files-folder"],
    });

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(415);
    expect(body.error).toMatch(/HEIC\/HEIF/i);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(sharpMocks.sharp).not.toHaveBeenCalled();
  });

  it("rejects oversized source images before fetching bytes", async () => {
    driveMocks.getFileMetadata.mockResolvedValueOnce({
      id: FILE_ID,
      name: "huge.heic",
      mimeType: "image/heic",
      size: 51 * 1024 * 1024,
      parents: ["raw-files-folder"],
    });

    const res = await GET(makeRequest());

    expect(res.status).toBe(413);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(sharpMocks.sharp).not.toHaveBeenCalled();
  });
});
