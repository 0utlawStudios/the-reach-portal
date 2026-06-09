import { afterEach, describe, expect, it } from "vitest";
import { uploadManyToDrive } from "@/lib/drive-upload";

const originalXhr = globalThis.XMLHttpRequest;

type XhrHandler = ((event?: ProgressEvent | { lengthComputable: boolean; loaded: number; total: number }) => void) | null;

interface MockUploadRun {
  sends: string[];
  active: number;
  maxActive: number;
  failNames: Set<string>;
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
        if (run.failNames.has(fileName)) {
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

function makeImage(name: string) {
  return new File(["0123456789"], name, { type: "image/jpeg" });
}

afterEach(() => {
  globalThis.XMLHttpRequest = originalXhr;
});

describe("uploadManyToDrive", () => {
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

  it("returns an empty result for an empty batch", async () => {
    await expect(uploadManyToDrive([], "raw-files")).resolves.toEqual([]);
  });
});
