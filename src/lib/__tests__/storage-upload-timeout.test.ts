import { afterEach, describe, expect, it, vi } from "vitest";
import { storageUploadBudgetMs, withStorageUploadTimeout } from "@/lib/storage-upload-timeout";

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
});
