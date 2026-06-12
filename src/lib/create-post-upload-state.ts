import type { BatchItemResult, DriveUploadResult } from "@/lib/drive-upload";

export interface CreatePostUploadFileState {
  id: string;
  name: string;
  size: string;
  type: "image" | "video";
  preview: string;
  driveUrl?: string;
  driveProxyUrl?: string;
  publishUrl?: string;
  playbackUrl?: string;
  playbackStorageKey?: string;
  driveFileId?: string;
  mediaAssetId?: string;
  mimeType?: string;
  driveSize?: number;
}

export interface PendingCreatePostUpload {
  index: number;
  fileId: string;
  file: File;
}

export interface AppliedCreatePostUploadResults<T extends CreatePostUploadFileState> {
  files: T[];
  successes: Array<{
    originalIndex: number;
    fileId: string;
    file: File;
    result: DriveUploadResult;
  }>;
  failures: Array<{
    originalIndex: number;
    fileId: string;
    file: File;
    error: Error;
  }>;
}

export function getPendingCreatePostUploads<T extends Pick<CreatePostUploadFileState, "id" | "driveUrl">>(
  files: readonly T[],
  rawFilesById: ReadonlyMap<string, File>,
): PendingCreatePostUpload[] {
  const pending: PendingCreatePostUpload[] = [];
  for (let index = 0; index < files.length; index++) {
    const fileState = files[index];
    if (fileState.driveUrl) continue;
    const file = rawFilesById.get(fileState.id);
    if (!file) continue;
    pending.push({ index, fileId: fileState.id, file });
  }
  return pending;
}

export function applyCreatePostUploadResults<T extends CreatePostUploadFileState>(
  files: readonly T[],
  pending: readonly PendingCreatePostUpload[],
  items: readonly BatchItemResult[],
): AppliedCreatePostUploadResults<T> {
  const next = files.map((file) => ({ ...file })) as T[];
  const successes: AppliedCreatePostUploadResults<T>["successes"] = [];
  const failures: AppliedCreatePostUploadResults<T>["failures"] = [];

  for (const item of items) {
    const pendingItem = pending[item.index];
    if (!pendingItem) continue;

    if (item.result) {
      next[pendingItem.index] = {
        ...next[pendingItem.index],
        driveUrl: item.result.url,
        driveProxyUrl: item.result.driveProxyUrl || item.result.url,
        publishUrl: item.result.publishUrl || item.result.url,
        driveFileId: item.result.fileId,
        mimeType: item.result.mimeType,
        driveSize: item.result.size,
      };
      successes.push({
        originalIndex: pendingItem.index,
        fileId: pendingItem.fileId,
        file: pendingItem.file,
        result: item.result,
      });
      continue;
    }

    if (item.error) {
      failures.push({
        originalIndex: pendingItem.index,
        fileId: pendingItem.fileId,
        file: pendingItem.file,
        error: item.error,
      });
    }
  }

  return { files: next, successes, failures };
}
