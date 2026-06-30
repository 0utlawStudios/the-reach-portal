import { VALID_DRIVE_FOLDERS } from "@/lib/drive-policy";
import { getRootFolderId, getSubfolderId } from "@/lib/google-drive";
import { driveFileIdFromUrl } from "@/lib/media-resolver";

export const BASELINE_WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";

export type MediaSizeBackfillRow = {
  id: string;
  name?: string | null;
  url?: string | null;
  file_id?: string | null;
  publish_url?: string | null;
  drive_proxy_url?: string | null;
  playback_url?: string | null;
  mime_type?: string | null;
  size_bytes?: number | null;
};

type DriveMetadataForSizeBackfill = {
  name?: string | null;
  mimeType?: string | null;
  size?: number | null;
  parents?: string[] | null;
  appProperties?: Record<string, string> | null;
};

let appManagedParentIdsPromise: Promise<Set<string>> | null = null;

async function getAppManagedParentIds(): Promise<Set<string>> {
  if (!appManagedParentIdsPromise) {
    appManagedParentIdsPromise = (async () => {
      const rootFolderId = getRootFolderId();
      const folderIds = await Promise.all(
        VALID_DRIVE_FOLDERS.map((folder) => getSubfolderId(folder, rootFolderId)),
      );
      return new Set(folderIds.filter((folderId): folderId is string => Boolean(folderId)));
    })().catch((err) => {
      appManagedParentIdsPromise = null;
      throw err;
    });
  }
  return appManagedParentIdsPromise;
}

async function driveMetadataCanRepairWorkspace(meta: DriveMetadataForSizeBackfill, workspaceId: string): Promise<boolean> {
  const fileWorkspaceId = meta.appProperties?.workspaceId;
  if (fileWorkspaceId) return fileWorkspaceId === workspaceId;
  if (workspaceId !== BASELINE_WORKSPACE_ID) return false;

  const parents = Array.isArray(meta.parents) ? meta.parents : [];
  if (parents.length === 0) return false;

  const appManagedParentIds = await getAppManagedParentIds();
  return parents.some((parentId) => appManagedParentIds.has(parentId));
}

export function driveFileIdForSizeBackfillRow(row: MediaSizeBackfillRow): string | null {
  return row.file_id || driveFileIdFromUrl(row.drive_proxy_url || row.url || row.publish_url || row.playback_url);
}

export async function buildMediaSizeMetadataUpdate(
  row: MediaSizeBackfillRow,
  meta: DriveMetadataForSizeBackfill,
  workspaceId: string,
  fileId: string,
): Promise<Record<string, unknown> | null> {
  if (!(await driveMetadataCanRepairWorkspace(meta, workspaceId))) return null;

  const metadataUpdate: Record<string, unknown> = {};
  if (!row.file_id) metadataUpdate.file_id = fileId;
  if (typeof meta.size === "number" && meta.size > 0) metadataUpdate.size_bytes = meta.size;
  if (!row.mime_type && meta.mimeType) metadataUpdate.mime_type = meta.mimeType;
  if ((!row.name || row.name === "Untitled asset") && meta.name) metadataUpdate.name = meta.name;
  return Object.keys(metadataUpdate).length > 0 ? metadataUpdate : null;
}
