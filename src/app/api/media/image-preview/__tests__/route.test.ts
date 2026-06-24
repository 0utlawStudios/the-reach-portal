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

const heicDecodeMocks = vi.hoisted(() => {
  const decode = vi.fn() as ReturnType<typeof vi.fn> & { all: ReturnType<typeof vi.fn> };
  decode.all = vi.fn();
  return { decode };
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

vi.mock("heic-decode", () => ({
  default: heicDecodeMocks.decode,
}));

import { GET } from "../route";

const FILE_ID = "abcdefghijklmnopqrst";
const originalFetch = globalThis.fetch;

function makeRequest(path = `/api/media/image-preview?id=${FILE_ID}&token=signed`) {
  return new NextRequest(`http://localhost:3000${path}`);
}

function installHeicDecodeImages(width = 4, height = 3) {
  const byteLength = width * height * 4;
  const dataLength = Number.isFinite(byteLength) && byteLength > 0 && byteLength <= 4096 ? byteLength : 16;
  const image = {
    width,
    height,
    decode: vi.fn(async () => ({
      width,
      height,
      data: new Uint8ClampedArray(dataLength).fill(128),
    })),
  };
  const images = Object.assign([image], { dispose: vi.fn() });
  heicDecodeMocks.decode.all.mockResolvedValue(images);
  return { image, images, dispose: images.dispose };
}

beforeEach(() => {
  vi.clearAllMocks();
  sharpMocks.sharp.format = { heif: { input: { buffer: true } } };
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
  installHeicDecodeImages();
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
    expect(heicDecodeMocks.decode.all).not.toHaveBeenCalled();
  });

  it("converts HEIC by filename when Drive reports a misleading image MIME", async () => {
    driveMocks.getFileMetadata.mockResolvedValueOnce({
      id: FILE_ID,
      name: "IMG_3748.HEIC",
      mimeType: "image/jpeg",
      size: 2 * 1024 * 1024,
      parents: ["media-library-folder"],
    });

    const res = await GET(makeRequest());
    const body = new Uint8Array(await res.arrayBuffer());

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(Array.from(body)).toEqual([0xff, 0xd8, 0xff]);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining(`/files/${FILE_ID}?alt=media`),
      expect.objectContaining({
        headers: { Authorization: "Bearer drive-token" },
      }),
    );
  });

  it("falls back to heic-decode when Sharp rejects iPhone HEVC HEIC input", async () => {
    const heic = installHeicDecodeImages(4, 3);
    sharpMocks.pipeline.toBuffer
      .mockRejectedValueOnce(new Error("Support for this compression format has not been built in"))
      .mockResolvedValueOnce(Buffer.from([0xff, 0xd8, 0x42]));

    const res = await GET(makeRequest());
    const body = new Uint8Array(await res.arrayBuffer());

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(Array.from(body)).toEqual([0xff, 0xd8, 0x42]);
    expect(heicDecodeMocks.decode.all).toHaveBeenCalledWith(expect.objectContaining({
      buffer: expect.any(Buffer),
    }));
    const decodeInput = heicDecodeMocks.decode.all.mock.calls[0]?.[0]?.buffer;
    expect(Buffer.isBuffer(decodeInput)).toBe(true);
    expect(Array.from(decodeInput as Buffer)).toEqual([1, 2, 3]);
    expect(heic.image.decode).toHaveBeenCalledTimes(1);
    expect(heic.dispose).toHaveBeenCalledTimes(1);
    expect(sharpMocks.sharp).toHaveBeenCalledTimes(2);
    expect(sharpMocks.sharp.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      raw: { width: 4, height: 3, channels: 4 },
      limitInputPixels: 50_000_000,
    }));
  });

  it("falls back to heic-decode when Sharp HEIF buffer input support is absent", async () => {
    const heic = installHeicDecodeImages(4, 3);
    sharpMocks.sharp.format = { heif: { input: { buffer: false } } };

    const res = await GET(makeRequest());
    const body = new Uint8Array(await res.arrayBuffer());

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(Array.from(body)).toEqual([0xff, 0xd8, 0xff]);
    expect(heicDecodeMocks.decode.all).toHaveBeenCalledWith(expect.objectContaining({
      buffer: expect.any(Buffer),
    }));
    expect(heic.image.decode).toHaveBeenCalledTimes(1);
    expect(heic.dispose).toHaveBeenCalledTimes(1);
    expect(sharpMocks.sharp).toHaveBeenCalledTimes(1);
  });

  it("rejects over-pixel fallback HEIC images before decoding raw pixels", async () => {
    const heic = installHeicDecodeImages(10_001, 10_000);
    sharpMocks.sharp.format = { heif: { input: { buffer: false } } };

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(413);
    expect(body.error).toBe("Image is too large for preview conversion");
    expect(heicDecodeMocks.decode.all).toHaveBeenCalledTimes(1);
    expect(heic.image.decode).not.toHaveBeenCalled();
    expect(heic.dispose).toHaveBeenCalledTimes(1);
    expect(sharpMocks.sharp).not.toHaveBeenCalled();
  });

  it("disposes fallback HEIC decoder resources when raw conversion fails", async () => {
    const heic = installHeicDecodeImages(4, 3);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    sharpMocks.sharp.format = { heif: { input: { buffer: false } } };
    sharpMocks.pipeline.toBuffer.mockRejectedValueOnce(new Error("raw conversion failed"));

    try {
      const res = await GET(makeRequest());

      expect(res.status).toBe(500);
      expect(heicDecodeMocks.decode.all).toHaveBeenCalledTimes(1);
      expect(heic.image.decode).toHaveBeenCalledTimes(1);
      expect(heic.dispose).toHaveBeenCalledTimes(1);
    } finally {
      consoleError.mockRestore();
    }
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
