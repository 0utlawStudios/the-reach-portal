const STORAGE_UPLOAD_BASE_MS = 30_000;
const STORAGE_UPLOAD_MIN_THROUGHPUT_BYTES_PER_SEC = 40 * 1024; // 40 KiB/s
export const STORAGE_CONTROL_PLANE_TIMEOUT_MS = 15_000;

async function withTimeout<T>(
  operation: PromiseLike<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  const TIMED_OUT = Symbol("storage-timeout");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const outcome = await Promise.race<T | typeof TIMED_OUT>([
    operation,
    new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });

  if (outcome === TIMED_OUT) {
    throw new Error(`${label} timed out. Check your connection and try again.`);
  }
  return outcome;
}

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
  return withTimeout(upload, storageUploadBudgetMs(fileSize), label);
}

export async function withStorageControlTimeout<T>(
  operation: PromiseLike<T>,
  label = "Storage request",
  timeoutMs = STORAGE_CONTROL_PLANE_TIMEOUT_MS,
): Promise<T> {
  return withTimeout(operation, timeoutMs, label);
}
