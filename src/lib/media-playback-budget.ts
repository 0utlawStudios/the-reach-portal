import type { SupabaseClient } from "@supabase/supabase-js";

// The Supabase free tier gives ONE shared 1 GB Storage pool across every bucket
// (media-playback, media-thumbnails, avatars, support-attachments). The playback
// bucket holds best-effort fast-scrub copies of videos <=50 MB, and nothing bounded
// it, so it would grow until it ate the whole 1 GB and starved thumbnails too.
//
// Hard total-size budget. ~300 MB headroom is left for thumbnails/avatars/attachments
// inside the 1 GB pool. An evicted copy is NOT data loss: the canonical original always
// lives on Drive, and every surface resolves a video as
// `playbackUrl || driveProxyUrl || url` (see media-resolver.ts / media-page / media-picker),
// so clearing playback_url repoints the asset to the Drive stream transparently.
export const PLAYBACK_BUCKET = "media-playback";
export const PLAYBACK_BUDGET_BYTES = 700 * 1024 * 1024;

type ListedObject = { key: string; size: number; recency: number };

// Storage keys are nested workspaceId/cardId/uuid-name.ext, so the flat .list() must
// recurse into folder entries (folders come back with a null id). The bucket is bounded
// (~700 MB => tens of objects), so this is a handful of list calls.
async function listAllPlaybackObjects(admin: SupabaseClient): Promise<ListedObject[]> {
  const out: ListedObject[] = [];
  const walk = async (prefix: string, depth: number): Promise<void> => {
    if (depth > 4) return; // ws/card/file is depth 2; guard against a pathological tree
    const { data, error } = await admin.storage
      .from(PLAYBACK_BUCKET)
      .list(prefix, { limit: 1000, sortBy: { column: "created_at", order: "asc" } });
    if (error || !data) return;
    for (const entry of data) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      const isFolder = !entry.id; // folders list with id === null
      if (isFolder) {
        await walk(path, depth + 1);
        continue;
      }
      const meta = entry.metadata as { size?: number } | null;
      const size = Number(meta?.size) || 0;
      // Prefer last-played (LRU); fall back to upload time. Either way the total stays bounded.
      const stamp = entry.last_accessed_at || entry.updated_at || entry.created_at || 0;
      out.push({ key: path, size, recency: new Date(stamp).getTime() || 0 });
    }
  };
  await walk("", 0);
  return out;
}

/**
 * Keep the media-playback bucket under PLAYBACK_BUDGET_BYTES before a new copy of
 * `incomingBytes` is written. Evicts least-recently-played copies (oldest first) until
 * the new object will fit, removing each from Storage and clearing the referencing
 * media_assets row so the app serves that video from Drive instead.
 *
 * Fail-OPEN: a budget read/evict error never blocks the upload (the copy is best-effort).
 */
export async function enforcePlaybackBudget(
  admin: SupabaseClient,
  incomingBytes: number,
): Promise<{ evicted: number; freedBytes: number }> {
  const incoming = Number.isFinite(incomingBytes) && incomingBytes > 0 ? incomingBytes : 0;

  let objects: ListedObject[];
  try {
    objects = await listAllPlaybackObjects(admin);
  } catch {
    return { evicted: 0, freedBytes: 0 };
  }

  let total = objects.reduce((sum, o) => sum + o.size, 0);
  if (total + incoming <= PLAYBACK_BUDGET_BYTES) return { evicted: 0, freedBytes: 0 };

  objects.sort((a, b) => a.recency - b.recency); // least-recently-played first

  let evicted = 0;
  let freedBytes = 0;
  for (const obj of objects) {
    if (total + incoming <= PLAYBACK_BUDGET_BYTES) break;
    const { error } = await admin.storage.from(PLAYBACK_BUCKET).remove([obj.key]);
    if (error) continue; // skip a stubborn object, try the next-oldest
    // Detach the evicted copy so the asset resolves to its Drive original next load.
    await admin
      .from("media_assets")
      .update({ playback_url: null, playback_storage_key: null })
      .eq("playback_storage_key", obj.key);
    total -= obj.size;
    freedBytes += obj.size;
    evicted += 1;
  }

  return { evicted, freedBytes };
}
