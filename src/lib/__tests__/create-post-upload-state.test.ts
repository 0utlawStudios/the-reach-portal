import { describe, expect, it } from "vitest";
import {
  applyCreatePostUploadResults,
  getPendingCreatePostUploads,
  type CreatePostUploadFileState,
} from "@/lib/create-post-upload-state";
import type { BatchItemResult } from "@/lib/drive-upload";

function makeState(index: number): CreatePostUploadFileState {
  return {
    id: `local-${index}`,
    name: `photo-${String(index + 1).padStart(2, "0")}.jpg`,
    size: "10 KB",
    type: "image",
    preview: `blob:photo-${index}`,
  };
}

function makeFile(index: number) {
  return new File(["0123456789"], `photo-${String(index + 1).padStart(2, "0")}.jpg`, { type: "image/jpeg" });
}

describe("create post upload state", () => {
  it("keeps successful uploads after a partial batch failure and retries only failed files", () => {
    const files = Array.from({ length: 30 }, (_, i) => makeState(i));
    const rawFiles = new Map(files.map((file, i) => [file.id, makeFile(i)]));
    const pending = getPendingCreatePostUploads(files, rawFiles);
    const failedIndex = 17;
    const batchResults: BatchItemResult[] = pending.map((pendingItem, batchIndex) => {
      if (pendingItem.index === failedIndex) {
        return { index: batchIndex, file: pendingItem.file, error: new Error("forced failure") };
      }
      return {
        index: batchIndex,
        file: pendingItem.file,
        result: {
          fileId: `drive-${pendingItem.file.name}`,
          url: `/api/drive/stream?id=drive-${pendingItem.file.name}`,
          mimeType: "image/jpeg",
          size: pendingItem.file.size,
        },
      };
    });

    const applied = applyCreatePostUploadResults(files, pending, batchResults);
    const retryPending = getPendingCreatePostUploads(applied.files, rawFiles);

    expect(applied.successes).toHaveLength(29);
    expect(applied.failures).toHaveLength(1);
    expect(applied.files.filter((file) => file.driveUrl)).toHaveLength(29);
    expect(applied.files[failedIndex].driveUrl).toBeUndefined();
    expect(retryPending).toHaveLength(1);
    expect(retryPending[0].index).toBe(failedIndex);
    expect(retryPending[0].file.name).toBe("photo-18.jpg");
  });
});
