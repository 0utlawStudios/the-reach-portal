import { afterEach, describe, expect, it, vi } from "vitest";
import {
  STORAGE_CONTROL_PLANE_TIMEOUT_MS,
  storageUploadBudgetMs,
  withStorageControlTimeout,
  withStorageUploadTimeout,
} from "@/lib/storage-upload-timeout";

afterEach(() => {
  vi.useRealTimers();
});

describe("storage upload timeout", () => {
  it("scales the timeout budget with upload size", () => {
    expect(storageUploadBudgetMs(0)).toBe(30_000);
    expect(storageUploadBudgetMs(40 * 1024 * 1024)).toBe(30_000 + 1_024_000);
  });

  it("fails closed when a storage upload never settles", async () => {
    vi.useFakeTimers();
    const pending = withStorageUploadTimeout(new Promise(() => {}), 10, "Support attachment");
    const assertion = expect(pending).rejects.toThrow(/Support attachment timed out/i);
    await vi.advanceTimersByTimeAsync(storageUploadBudgetMs(10) + 10);
    await assertion;
  });

  it("returns the upload result when storage settles before the budget", async () => {
    await expect(withStorageUploadTimeout(Promise.resolve({ error: null }), 10)).resolves.toEqual({ error: null });
  });

  it("fails closed when a storage control-plane request never settles", async () => {
    vi.useFakeTimers();
    const pending = withStorageControlTimeout(new Promise(() => {}), "Storage signed URL");
    const assertion = expect(pending).rejects.toThrow(/Storage signed URL timed out/i);
    await vi.advanceTimersByTimeAsync(STORAGE_CONTROL_PLANE_TIMEOUT_MS + 10);
    await assertion;
  });

  it("returns the control-plane result when storage settles before the budget", async () => {
    await expect(withStorageControlTimeout(Promise.resolve({ data: "ok" }))).resolves.toEqual({ data: "ok" });
  });
});
