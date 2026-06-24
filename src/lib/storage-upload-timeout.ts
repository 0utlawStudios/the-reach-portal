const STORAGE_UPLOAD_BASE_MS = 30_000;
const STORAGE_UPLOAD_MIN_THROUGHPUT_BYTES_PER_SEC = 40 * 1024; // 40 KiB/s

export function storageUploadBudgetMs(fileSize: number): number {
  const bytes = Number.isFinite(fileSize) && fileSize > 0 ? fileSize : 0;
  const transferMs = Math.ceil((bytes / STORAGE_UPLOAD_MIN_THROUGHPUT_BYTES_PER_SEC) * 1000);
  return STORAGE_UPLOAD_BASE_MS + transferMs;
}

export async function withStorageUploadTimeout<T>(
  upload: PromiseLike<T>,
  fileSize: number,
  label = "Storage upload",
): Promise<T> {
  const TIMED_OUT = Symbol("storage-upload-timeout");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const outcome = await Promise.race<T | typeof TIMED_OUT>([
    upload,
    new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), storageUploadBudgetMs(fileSize));
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });

  if (outcome === TIMED_OUT) {
    throw new Error(`${label} timed out. Check your connection and try again.`);
  }
  return outcome;
}
