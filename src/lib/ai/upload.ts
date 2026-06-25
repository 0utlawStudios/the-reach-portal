// Upload processed images to the private `ai-assets` Supabase bucket. Signed
// URLs are still useful inside the worker immediately after upload, but the UI
// renders durable `/api/ai/asset?key=...` proxy URLs derived from storage keys.

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { withStorageControlTimeout, withStorageUploadTimeout } from "@/lib/storage-upload-timeout";

const BUCKET = "ai-assets";
const SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60;
const AI_ASSET_STORAGE_CONCURRENCY = 3;

export const AI_ASSETS_SIGNED_URL_TTL = SIGNED_URL_TTL_SECONDS;

function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase admin not configured");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export interface UploadedAsset {
  storageKey: string;
  signedUrl: string;
}

async function mapWithConcurrency<T, R>(
  items: ReadonlyArray<T>,
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workerCount = Math.max(1, Math.min(items.length || 1, Math.floor(Number.isFinite(concurrency) ? concurrency : AI_ASSET_STORAGE_CONCURRENCY)));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  }));
  return results;
}

export async function uploadAssets(args: {
  workspaceId: string;
  postId: string;
  images: ReadonlyArray<{ bytes: Buffer; mime: string }>;
}): Promise<UploadedAsset[]> {
  const sb = adminClient();
  return mapWithConcurrency(args.images, AI_ASSET_STORAGE_CONCURRENCY, async (img, i) => {
    const ext = img.mime === "image/png" ? "png" : img.mime === "image/jpeg" ? "jpg" : "webp";
    const storageKey = `${args.workspaceId}/${args.postId}/slide-${i + 1}.${ext}`;
    const { error: upErr } = await withStorageUploadTimeout(
      sb.storage.from(BUCKET).upload(storageKey, img.bytes, {
        contentType: img.mime,
        upsert: true,
      }),
      img.bytes.byteLength,
      `AI asset upload ${storageKey}`,
    );
    if (upErr) throw new Error(`Upload failed for ${storageKey}: ${upErr.message}`);
    const { data, error: signErr } = await withStorageControlTimeout(
      sb.storage.from(BUCKET).createSignedUrl(storageKey, SIGNED_URL_TTL_SECONDS),
      `AI asset signed URL ${storageKey}`,
    );
    if (signErr || !data?.signedUrl) {
      throw new Error(`Signed URL failed for ${storageKey}: ${signErr?.message || "unknown"}`);
    }
    return { storageKey, signedUrl: data.signedUrl };
  });
}

/**
 * Re-sign storage keys. Used by the post-fetch path when an existing signed
 * URL is within 24h of expiry, AND by the worker after a storage re-key
 * (so the signed URLs match the new keys).
 */
export async function resignAssets(
  storageKeys: ReadonlyArray<string>,
): Promise<string[]> {
  const sb = adminClient();
  return mapWithConcurrency(storageKeys, AI_ASSET_STORAGE_CONCURRENCY, async (key) => {
    const { data, error } = await withStorageControlTimeout(
      sb.storage.from(BUCKET).createSignedUrl(key, SIGNED_URL_TTL_SECONDS),
      `AI asset re-sign ${key}`,
    );
    if (error || !data?.signedUrl) {
      throw new Error(`Re-sign failed for ${key}: ${error?.message || "unknown"}`);
    }
    return data.signedUrl;
  });
}

/**
 * Move existing storage objects to a new prefix (e.g. provisional id → real
 * post.id), re-sign URLs against the new keys, and return the updated tuples.
 *
 * Why: Supabase Storage signed URLs are bound to the original path. If you
 * move the object and forget to re-sign, the old signed URL 404s.
 */
export async function rekeyAndResignAssets(args: {
  oldPrefix: string;     // e.g. "{workspace_id}/{provisional_id}/"
  newPrefix: string;     // e.g. "{workspace_id}/{post_id}/"
  assets: ReadonlyArray<UploadedAsset>;
}): Promise<UploadedAsset[]> {
  const sb = adminClient();
  return mapWithConcurrency(args.assets, AI_ASSET_STORAGE_CONCURRENCY, async (a) => {
    const newKey = a.storageKey.startsWith(args.oldPrefix)
      ? args.newPrefix + a.storageKey.slice(args.oldPrefix.length)
      : a.storageKey;
    if (newKey !== a.storageKey) {
      const { error: moveErr } = await withStorageControlTimeout(
        sb.storage.from(BUCKET).move(a.storageKey, newKey),
        `AI asset move ${a.storageKey}`,
      );
      if (moveErr) {
        // Couldn't move — keep the old key + URL so the post stays usable.
        return a;
      }
    }
    const { data, error: signErr } = await withStorageControlTimeout(
      sb.storage.from(BUCKET).createSignedUrl(newKey, SIGNED_URL_TTL_SECONDS),
      `AI asset re-sign ${newKey}`,
    );
    if (signErr || !data?.signedUrl) {
      // Move succeeded but re-sign failed — fall back to the old (now stale) URL.
      return { storageKey: newKey, signedUrl: a.signedUrl };
    }
    return { storageKey: newKey, signedUrl: data.signedUrl };
  });
}

export async function moveAssetsBestEffort(
  moves: ReadonlyArray<{ from: string; to: string }>,
  label = "AI asset move",
): Promise<void> {
  if (moves.length === 0) return;
  const sb = adminClient();
  for (const move of moves) {
    if (!move.from || !move.to || move.from === move.to) continue;
    try {
      const { error } = await withStorageControlTimeout(
        sb.storage.from(BUCKET).move(move.from, move.to),
        `${label} ${move.from}`,
      );
      if (error) {
        console.warn(`[ai-upload] ${label} failed for ${move.from}:`, error.message);
      }
    } catch (err) {
      console.warn(`[ai-upload] ${label} skipped for ${move.from}:`, err instanceof Error ? err.message : err);
    }
  }
}
