import { supabase } from "./supabaseClient";
// Single source of truth for UUID validation. A local copy here drifted from
// the canonical guard (it lacked the version/variant nibble checks and so
// accepted the zero-UUID) — see AGENTS.md §5. Always import the strict one.
import { isValidUuid } from "./utils";
import { mediaUrlAliases } from "./media-usage";

export const MEDIA_ASSET_SYNC_TIMEOUT_MS = 8_000;

interface EnsureMediaAssetParams {
  name: string;
  url: string;
  fileId?: string;
  publishUrl?: string;
  driveProxyUrl?: string;
  playbackUrl?: string;
  playbackStorageKey?: string;
  mimeType?: string;
  size?: number;
  fileType: "image" | "video";
  folder: string;
  addedBy: string;
  workspaceId: string;
  usedIn?: string; // post UUID — only set when the post has a real UUID, not a temp timestamp
}

async function withMediaAssetTimeout<T>(operation: PromiseLike<T>, label: string): Promise<T> {
  const TIMED_OUT = Symbol("media-asset-timeout");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const outcome = await Promise.race<T | typeof TIMED_OUT>([
    operation,
    new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), MEDIA_ASSET_SYNC_TIMEOUT_MS);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });

  if (outcome === TIMED_OUT) {
    throw new Error(`${label} timed out. The uploaded media was kept, but Media Library linking needs a retry.`);
  }
  return outcome;
}

/**
 * Insert a media asset row if one doesn't already exist for this URL.
 * If a row already exists and a valid post UUID is provided, appends the
 * post ID to the `used_in` array. Safe to call multiple times — idempotent.
 */
export async function ensureMediaAsset(params: EnsureMediaAssetParams): Promise<string> {
  return withMediaAssetTimeout(ensureMediaAssetInner(params), "Media asset sync");
}

async function ensureMediaAssetInner(params: EnsureMediaAssetParams): Promise<string> {
  const { name, url, fileId, publishUrl, driveProxyUrl, playbackUrl, playbackStorageKey, mimeType, size, fileType, folder, addedBy, workspaceId, usedIn } = params;
  const wsId = workspaceId || "00000000-0000-0000-0000-000000000001";
  const metadataUpdate: Record<string, unknown> = {
    name,
    url,
    file_type: fileType,
    folder,
    added_by: addedBy,
  };
  if (fileId) metadataUpdate.file_id = fileId;
  if (publishUrl) metadataUpdate.publish_url = publishUrl;
  if (driveProxyUrl) metadataUpdate.drive_proxy_url = driveProxyUrl;
  if (playbackUrl) metadataUpdate.playback_url = playbackUrl;
  if (playbackStorageKey) metadataUpdate.playback_storage_key = playbackStorageKey;
  if (mimeType) metadataUpdate.mime_type = mimeType;
  if (typeof size === "number" && Number.isFinite(size)) metadataUpdate.size_bytes = size;

  // 1. Check if a row with this URL already exists IN THIS WORKSPACE.
  // RLS already gates this at the DB level, but the explicit workspace_id
  // filter is belt-and-suspenders against a future code path that mistakenly
  // uses the admin client here.
  const aliases = Array.from(mediaUrlAliases({ url, fileId, publishUrl, driveProxyUrl, playbackUrl }));
  const { data: existingRows, error: lookupError } = await supabase
    .from("media_assets")
    .select("id, used_in")
    .in("url", aliases.length > 0 ? aliases : [url])
    .eq("workspace_id", wsId)
    .limit(1);
  if (lookupError) {
    throw new Error(`Media asset lookup failed: ${lookupError.message}`);
  }
  const existing = existingRows?.[0];

  if (existing) {
    // Row exists — only update used_in if we have a real post UUID to add
    const nextUsedIn = new Set<string>(existing.used_in || []);
    if (usedIn && isValidUuid(usedIn)) {
      nextUsedIn.add(usedIn);
    }
    const { data: updated, error: updateError } = await supabase
      .from("media_assets")
      .update({ ...metadataUpdate, used_in: Array.from(nextUsedIn) })
      .eq("id", existing.id)
      .eq("workspace_id", wsId)
      .select("id")
      .maybeSingle();
    if (updateError) {
      throw new Error(`Media asset update failed: ${updateError.message}`);
    }
    if (!updated) {
      throw new Error("Media asset update failed: no matching workspace row was updated.");
    }
    return updated.id;
  }

  // 2. Insert new row
  const usedInArray = usedIn && isValidUuid(usedIn) ? [usedIn] : [];
  const { data: inserted, error } = await supabase
    .from("media_assets")
    .insert({
      ...metadataUpdate,
      workspace_id: wsId,
      used_in: usedInArray,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(`Media asset insert failed: ${error.message}`);
  }
  if (!inserted) {
    throw new Error("Media asset insert failed: no row was created.");
  }
  return inserted.id;
}
