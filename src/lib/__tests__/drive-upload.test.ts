import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSession = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabaseClient", () => ({
  supabase: {
    auth: {
      getSession: mockGetSession,
    },
  },
}));

import { retryDelayWithJitter, uploadManyToDrive } from "@/lib/drive-upload";

const originalXhr = globalThis.XMLHttpRequest;
const originalFetch = globalThis.fetch;

type XhrHandler = ((event?: ProgressEvent | { lengthComputable: boolean; loaded: number; total: number }) => void) | null;

interface MockUploadRun {
  sends: string[];
  active: number;
  maxActive: number;
  failNames: Set<string>;
  responsesByName?: Map<string, Array<{ status: number; body: Record<string, unknown> }>>;
}

interface MixedUploadRun {
  proxySends: string[];
  directSends: string[];
  sessionRequests: string[];
  finalizeRequests: string[];
  active: number;
  maxActive: number;
  failDirectNames: Set<string>;
}

interface StallingChunkRun {
  chunkRanges: string[];
  chunkUploadUris: string[];
  sessionRequests: string[];
  finalizeRequests: string[];
  stalledOnce: boolean;
}

function installProxyUploadXhrMock(run: MockUploadRun) {
  class MockXHR {
    upload: { onprogress: XhrHandler } = { onprogress: null };
    onload: XhrHandler = null;
    onerror: XhrHandler = null;
    ontimeout: XhrHandler = null;
    onabort: XhrHandler = null;
    status = 0;
    responseText = "";
    timeout = 0;

    open() {}
    setRequestHeader() {}
    abort() {
      this.onabort?.();
    }
    send(body: FormData) {
      const fileName = String(body.get("fileName") || "upload.jpg");
      run.sends.push(fileName);
      run.active++;
      run.maxActive = Math.max(run.maxActive, run.active);
      setTimeout(() => {
        this.upload.onprogress?.({ lengthComputable: true, loaded: 10, total: 10 });
        const queued = run.responsesByName?.get(fileName);
        const next = queued?.shift();
        if (next) {
          this.status = next.status;
          this.responseText = JSON.stringify(next.body);
        } else if (run.failNames.has(fileName)) {
          this.status = 400;
          this.responseText = JSON.stringify({ error: "Upload failed: 400" });
        } else {
          this.status = 200;
          this.responseText = JSON.stringify({
            fileId: `drive-${fileName}`,
            url: `/api/drive/stream?id=drive-${fileName}`,
            mimeType: fileName.endsWith(".mp4") ? "video/mp4" : "image/jpeg",
            size: 10,
          });
        }
        run.active--;
        this.onload?.();
      }, 1);
    }
  }

  globalThis.XMLHttpRequest = MockXHR as unknown as typeof XMLHttpRequest;
}

function installMixedUploadMocks(run: MixedUploadRun, onSend?: (timeout: number) => void) {
  class MockXHR {
    upload: { onprogress: XhrHandler } = { onprogress: null };
    onload: XhrHandler = null;
    onerror: XhrHandler = null;
    ontimeout: XhrHandler = null;
    onabort: XhrHandler = null;
    status = 0;
    responseText = "";
    timeout = 0;
    private method = "";
    private url = "";
    private headers: Record<string, string> = {};

    open(method: string, url: string) {
      this.method = method;
      this.url = url;
    }
    setRequestHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value;
    }
    abort() {
      this.onabort?.();
    }
    send(body: FormData | File | Blob) {
      // Capture whatever xhr.timeout the production code set before send(). A
      // non-zero ceiling here is the 2026-06-24 "Upload timed out" bug.
      onSend?.(this.timeout);
      const isProxy = this.method === "POST" && this.url === "/api/drive/proxy-upload";
      const isChunk = this.method === "POST" && this.url === "/api/drive/upload-chunk";
      const fileName = isProxy
        ? String((body as FormData).get("fileName") || "upload.jpg")
        : isChunk ? this.headers["x-file-name"] || "upload.bin"
        : body instanceof File ? body.name : "upload.bin";
      if (isProxy) run.proxySends.push(fileName);
      else run.directSends.push(fileName);
      run.active++;
      run.maxActive = Math.max(run.maxActive, run.active);
      setTimeout(() => {
        const uploadTotal = body instanceof Blob ? body.size || 10 : 10;
        this.upload.onprogress?.({ lengthComputable: true, loaded: uploadTotal, total: uploadTotal });
        if (!isProxy && run.failDirectNames.has(fileName)) {
          this.status = 403;
          this.responseText = JSON.stringify({
            error: {
              code: 403,
              message: "raw Google userRateLimitExceeded text must not reach the browser",
              errors: [{ reason: "userRateLimitExceeded" }],
            },
          });
        } else {
          this.status = 200;
          const range = this.headers["content-range"]?.match(/^bytes \d+-(\d+)\/(\d+)$/);
          const isFinalChunk = !range || Number(range[1]) + 1 >= Number(range[2]);
          this.responseText = JSON.stringify(isProxy ? {
            fileId: `drive-${fileName}`,
            url: `/api/drive/stream?id=drive-${fileName}`,
            mimeType: "image/jpeg",
            size: 10,
          } : isFinalChunk ? {
            done: true,
            fileId: `drive-${fileName}`,
          } : {
            done: false,
            range: range ? `bytes=0-${range[1]}` : null,
          });
        }
        run.active--;
        this.onload?.();
      }, 1);
    }
  }

  globalThis.XMLHttpRequest = MockXHR as unknown as typeof XMLHttpRequest;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/drive/upload") {
      const body = JSON.parse(String(init?.body || "{}")) as { fileName?: string };
      const fileName = body.fileName || "upload.bin";
      run.sessionRequests.push(fileName);
      return Response.json({ uploadUri: `https://upload.example/${encodeURIComponent(fileName)}` });
    }
    if (url === "/api/drive/finalize") {
      const body = JSON.parse(String(init?.body || "{}")) as { fileId?: string; folder?: string };
      const fileId = body.fileId || "missing";
      run.finalizeRequests.push(`${fileId}:${body.folder || ""}`);
      return Response.json({
        fileId,
        url: `/api/drive/stream?id=${fileId}`,
        mimeType: fileId.endsWith(".mp4") ? "video/mp4" : "image/jpeg",
        size: fileId.endsWith(".mp4") ? 4 * 1024 * 1024 + 1 : 10,
      });
    }
    throw new Error(`Unexpected fetch ${url}`);
  }) as unknown as typeof fetch;
}

function installStallingChunkUploadMocks(run: StallingChunkRun) {
  class MockXHR {
    upload: { onprogress: XhrHandler } = { onprogress: null };
    onload: XhrHandler = null;
    onerror: XhrHandler = null;
    ontimeout: XhrHandler = null;
    onabort: XhrHandler = null;
    status = 0;
    responseText = "";
    timeout = 0;
    private method = "";
    private url = "";
    private headers: Record<string, string> = {};

    open(method: string, url: string) {
      this.method = method;
      this.url = url;
    }
    setRequestHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value;
    }
    abort() {
      this.onabort?.();
    }
    send(body: Blob) {
      if (this.method !== "POST" || this.url !== "/api/drive/upload-chunk") {
        throw new Error(`Unexpected XHR ${this.method} ${this.url}`);
      }

      const range = this.headers["content-range"] || "";
      run.chunkRanges.push(range);
      run.chunkUploadUris.push(this.headers["x-upload-uri"] || "");

      if (!run.stalledOnce && range.startsWith("bytes 0-")) {
        run.stalledOnce = true;
        return;
      }

      setTimeout(() => {
        const uploadTotal = body.size || 10;
        this.upload.onprogress?.({ lengthComputable: true, loaded: uploadTotal, total: uploadTotal });
        const match = range.match(/^bytes \d+-(\d+)\/(\d+)$/);
        const isFinalChunk = !match || Number(match[1]) + 1 >= Number(match[2]);
        this.status = 200;
        this.responseText = JSON.stringify(isFinalChunk ? {
          done: true,
          fileId: `drive-${this.headers["x-file-name"]}`,
        } : {
          done: false,
        });
        this.onload?.();
      }, 1);
    }
  }

  globalThis.XMLHttpRequest = MockXHR as unknown as typeof XMLHttpRequest;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/drive/upload") {
      const body = JSON.parse(String(init?.body || "{}")) as { fileName?: string };
      const fileName = body.fileName || "upload.bin";
      run.sessionRequests.push(fileName);
      return Response.json({ uploadUri: `https://upload.example/session-${run.sessionRequests.length}` });
    }
    if (url === "/api/drive/finalize") {
      const body = JSON.parse(String(init?.body || "{}")) as { fileId?: string; folder?: string };
      const fileId = body.fileId || "missing";
      run.finalizeRequests.push(`${fileId}:${body.folder || ""}`);
      return Response.json({
        fileId,
        url: `/api/drive/stream?id=${fileId}`,
        mimeType: "video/mp4",
        size: 4 * 1024 * 1024,
      });
    }
    throw new Error(`Unexpected fetch ${url}`);
  }) as unknown as typeof fetch;
}

function makeImage(name: string) {
  return new File(["0123456789"], name, { type: "image/jpeg" });
}

async function flushPromises(times = 20) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

async function waitForChunkSends(run: StallingChunkRun, count: number) {
  for (let i = 0; i < 20 && run.chunkRanges.length < count; i++) {
    await flushPromises();
    await vi.advanceTimersByTimeAsync(0);
  }
}

beforeEach(() => {
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ data: { session: { access_token: "test-token" } } });
});

afterEach(() => {
  globalThis.XMLHttpRequest = originalXhr;
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("uploadManyToDrive", () => {
  it("adds jitter to retry delays", () => {
    expect(retryDelayWithJitter(1000, 0.5)).toBe(1500);
  });

  it("settles every file in a 30-item batch when one file fails", async () => {
    const run: MockUploadRun = {
      sends: [],
      active: 0,
      maxActive: 0,
      failNames: new Set(["photo-08.jpg"]),
    };
    installProxyUploadXhrMock(run);
    const files = Array.from({ length: 30 }, (_, i) => makeImage(`photo-${String(i + 1).padStart(2, "0")}.jpg`));

    const results = await uploadManyToDrive(files, "raw-files", { concurrency: 3, stopOnError: true });

    expect(results).toHaveLength(30);
    expect(results.map((item) => item.index)).toEqual(Array.from({ length: 30 }, (_, i) => i));
    expect(results.filter((item) => item.result)).toHaveLength(29);
    expect(results.filter((item) => item.error)).toHaveLength(1);
    expect(results.find((item) => item.error)?.file.name).toBe("photo-08.jpg");
    expect(run.sends).toHaveLength(30);
    expect(run.maxActive).toBeLessThanOrEqual(3);
  });

  it("leaves Preparing immediately while a 30-photo proxy batch waits on auth preflight", async () => {
    let releaseSession!: (value: unknown) => void;
    mockGetSession.mockReturnValue(new Promise((resolve) => { releaseSession = resolve; }));
    const run: MockUploadRun = {
      sends: [],
      active: 0,
      maxActive: 0,
      failNames: new Set(),
    };
    installProxyUploadXhrMock(run);
    const files = Array.from({ length: 30 }, (_, i) => makeImage(`photo-${String(i + 1).padStart(2, "0")}.jpg`));
    const progress: number[] = [];

    const pending = uploadManyToDrive(files, "raw-files", {
      concurrency: 3,
      onProgress: (p) => progress.push(p),
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(progress.some((p) => p > 0)).toBe(true);
    expect(run.sends).toEqual([]);

    releaseSession({ data: { session: { access_token: "test-token" } } });
    const results = await pending;

    expect(results).toHaveLength(30);
    expect(results.every((item) => item.result && !item.error)).toBe(true);
    expect(run.sends).toHaveLength(30);
  });

  it("times out stalled auth preflight on proxy and resumable paths instead of hanging at Preparing", async () => {
    vi.useFakeTimers();
    mockGetSession.mockReturnValue(new Promise(() => {}));
    const run: MixedUploadRun = {
      proxySends: [],
      directSends: [],
      sessionRequests: [],
      finalizeRequests: [],
      active: 0,
      maxActive: 0,
      failDirectNames: new Set(),
    };
    installMixedUploadMocks(run);
    const largeVideo = new Uint8Array(4 * 1024 * 1024 + 1);
    const progress: number[] = [];

    const pending = uploadManyToDrive([
      makeImage("photo-preflight.jpg"),
      new File([largeVideo], "video-preflight.mp4", { type: "video/mp4" }),
    ], "raw-files", {
      concurrency: 2,
      onProgress: (p) => progress.push(p),
    });

    await vi.advanceTimersByTimeAsync(10_001);
    const results = await pending;

    expect(results).toHaveLength(2);
    expect(results.every((item) => item.error?.message === "Upload authorization failed. Please sign in again.")).toBe(true);
    expect(progress.some((p) => p > 0)).toBe(true);
    expect(run.proxySends).toEqual([]);
    expect(run.directSends).toEqual([]);
    expect(run.sessionRequests).toEqual([]);
    expect(run.finalizeRequests).toEqual([]);
  });

  it("isolates a hostile unsupported file without blocking valid siblings", async () => {
    const run: MockUploadRun = {
      sends: [],
      active: 0,
      maxActive: 0,
      failNames: new Set(),
    };
    installProxyUploadXhrMock(run);
    const valid = makeImage("valid.jpg");
    const hostile = new File(["nope"], "malware.exe", { type: "application/octet-stream" });

    const results = await uploadManyToDrive([valid, hostile], "media-library", { concurrency: 2 });

    expect(results).toHaveLength(2);
    expect(results[0].result?.fileId).toBe("drive-valid.jpg");
    expect(results[1].error?.message).toContain("Unsupported file type");
    expect(run.sends).toEqual(["valid.jpg"]);
  });

  it("retries a Drive quota 429 from the proxy path", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const run: MockUploadRun = {
      sends: [],
      active: 0,
      maxActive: 0,
      failNames: new Set(),
      responsesByName: new Map([[
        "quota.jpg",
        [
          {
            status: 429,
            body: {
              error: "Storage is busy. Retrying automatically.",
              errorReason: "driveRateLimited",
              retryable: true,
            },
          },
        ],
      ]]),
    };
    installProxyUploadXhrMock(run);

    const results = await uploadManyToDrive([makeImage("quota.jpg")], "raw-files");

    expect(results).toHaveLength(1);
    expect(results[0].result?.fileId).toBe("drive-quota.jpg");
    expect(results[0].error).toBeUndefined();
    expect(run.sends).toEqual(["quota.jpg", "quota.jpg"]);
  });

  it("does not hammer this app's own upload limiter 429", async () => {
    const run: MockUploadRun = {
      sends: [],
      active: 0,
      maxActive: 0,
      failNames: new Set(),
      responsesByName: new Map([[
        "limited.jpg",
        [
          {
            status: 429,
            body: {
              error: "Too many uploads. Please wait a moment before trying again.",
              errorReason: "appRateLimited",
              retryable: false,
              retryAfterMs: 30_000,
            },
          },
        ],
      ]]),
    };
    installProxyUploadXhrMock(run);

    const results = await uploadManyToDrive([makeImage("limited.jpg")], "raw-files");

    expect(results).toHaveLength(1);
    expect(results[0].result).toBeUndefined();
    expect(results[0].error?.message).toBe("Too many uploads. Please wait a moment before trying again.");
    expect(run.sends).toEqual(["limited.jpg"]);
  });

  it("does not retry permanent Drive 400, 404, or 415 failures", async () => {
    const run: MockUploadRun = {
      sends: [],
      active: 0,
      maxActive: 0,
      failNames: new Set(),
      responsesByName: new Map([
        ["bad-400.jpg", [{ status: 400, body: { error: { code: 400, message: "raw bad request" } } }]],
        ["missing-404.jpg", [{ status: 404, body: { error: { code: 404, errors: [{ reason: "notFound" }] } } }]],
        ["type-415.jpg", [{ status: 415, body: { error: { code: 415, message: "raw unsupported type" } } }]],
      ]),
    };
    installProxyUploadXhrMock(run);

    const results = await uploadManyToDrive([
      makeImage("bad-400.jpg"),
      makeImage("missing-404.jpg"),
      makeImage("type-415.jpg"),
    ], "raw-files", { concurrency: 3 });

    expect(results).toHaveLength(3);
    expect(results.every((item) => item.error && !item.result)).toBe(true);
    expect(run.sends.sort()).toEqual(["bad-400.jpg", "missing-404.jpg", "type-415.jpg"]);
    expect(results.map((item) => item.error?.message).sort()).toEqual([
      "The upload request is invalid.",
      "The uploaded file could not be found.",
      "Unsupported file type for this upload location.",
    ]);
  });

  it("keeps a mixed image/video batch when one large video gets a Drive quota 403", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const run: MixedUploadRun = {
      proxySends: [],
      directSends: [],
      sessionRequests: [],
      finalizeRequests: [],
      active: 0,
      maxActive: 0,
      failDirectNames: new Set(["video-fail.mp4"]),
    };
    installMixedUploadMocks(run);
    const largeVideo = new Uint8Array(4 * 1024 * 1024 + 1);
    const files = [
      makeImage("photo-1.jpg"),
      new File([largeVideo], "video-fail.mp4", { type: "video/mp4" }),
      makeImage("photo-2.jpg"),
      new File([largeVideo], "video-ok.mp4", { type: "video/mp4" }),
    ];

    const results = await uploadManyToDrive(files, "raw-files", { concurrency: 3 });

    expect(results).toHaveLength(4);
    expect(results.filter((item) => item.result).map((item) => item.file.name).sort()).toEqual([
      "photo-1.jpg",
      "photo-2.jpg",
      "video-ok.mp4",
    ]);
    const failed = results.find((item) => item.file.name === "video-fail.mp4");
    expect(failed?.result).toBeUndefined();
    expect(failed?.error?.message).toBe("Storage is busy. Retrying automatically.");
    expect(failed?.error?.message).not.toContain("raw Google");
    expect(run.proxySends.sort()).toEqual(["photo-1.jpg", "photo-2.jpg"]);
    expect(run.directSends.filter((name) => name === "video-fail.mp4")).toHaveLength(2);
    expect(run.directSends).toContain("video-ok.mp4");
    expect(run.sessionRequests.filter((name) => name === "video-fail.mp4")).toHaveLength(2);
    expect(run.finalizeRequests).toEqual(["drive-video-ok.mp4:raw-files"]);
    expect(run.maxActive).toBeLessThanOrEqual(3);
  });

  it("returns an empty result for an empty batch", async () => {
    await expect(uploadManyToDrive([], "raw-files")).resolves.toEqual([]);
  });

  // Regression: 2026-06-24 production incident. A 5.55 MB JPEG on the resumable
  // path failed with "Upload timed out." (client xhr.ontimeout) even though the
  // server never errored — a slow-but-still-progressing uplink hit a fixed
  // xhr.timeout ceiling. The byte-transfer XHRs (proxy POST and resumable
  // chunk POST) must NOT arm a hard timeout: a moving upload is bounded only by
  // the no-progress stall watchdog and the post-send response timer, so a slow
  // connection can take as long as it needs as long as bytes keep flowing.
  it("never arms a hard XHR timeout ceiling on the byte-transfer requests", async () => {
    const transferTimeouts: number[] = [];
    const run: MixedUploadRun = {
      proxySends: [],
      directSends: [],
      sessionRequests: [],
      finalizeRequests: [],
      active: 0,
      maxActive: 0,
      failDirectNames: new Set(),
    };
    installMixedUploadMocks(run, (timeout) => transferTimeouts.push(timeout));
    const largeVideo = new Uint8Array(4 * 1024 * 1024 + 1);

    const results = await uploadManyToDrive([
      makeImage("small.jpg"), // < 4 MB → proxy POST
      new File([largeVideo], "big.mp4", { type: "video/mp4" }), // ≥ 4 MB → resumable chunk POST
    ], "raw-files", { concurrency: 2 });

    expect(results.every((item) => item.result && !item.error)).toBe(true);
    // Both transfer paths must have been exercised (proxy + ≥1 chunk).
    expect(transferTimeouts.length).toBeGreaterThan(1);
    expect(run.proxySends).toContain("small.jpg");
    expect(run.directSends).toContain("big.mp4");
    // The bug set this to 120000 on every transfer XHR. A moving upload must
    // never be killed by a fixed ceiling — the watchdog + response timer govern.
    expect(transferTimeouts.every((timeout) => timeout === 0)).toBe(true);
  });

  it("retries a stalled resumable chunk in place without restarting the upload session", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const run: StallingChunkRun = {
      chunkRanges: [],
      chunkUploadUris: [],
      sessionRequests: [],
      finalizeRequests: [],
      stalledOnce: false,
    };
    installStallingChunkUploadMocks(run);
    const largeVideo = new Uint8Array(4 * 1024 * 1024);

    const pending = uploadManyToDrive([
      new File([largeVideo], "stalled.mp4", { type: "video/mp4" }),
    ], "raw-files");

    await waitForChunkSends(run, 1);
    expect(run.chunkRanges).toEqual(["bytes 0-2097151/4194304"]);

    await vi.advanceTimersByTimeAsync(30_000);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(1);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(1);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(1);

    const results = await pending;

    expect(results).toHaveLength(1);
    expect(results[0].error).toBeUndefined();
    expect(results[0].result?.fileId).toBe("drive-stalled.mp4");
    expect(run.sessionRequests).toEqual(["stalled.mp4"]);
    expect(run.chunkRanges.slice(0, 2)).toEqual([
      "bytes 0-2097151/4194304",
      "bytes 0-2097151/4194304",
    ]);
    expect(new Set(run.chunkUploadUris.slice(0, 2)).size).toBe(1);
    expect(run.finalizeRequests).toEqual(["drive-stalled.mp4:raw-files"]);
  });
});
