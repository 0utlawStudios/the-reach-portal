// Upload processed images to the private `ai-assets` Supabase bucket. Signed
// URLs are still useful inside the worker immediately after upload, but the UI
// renders durable `/api/ai/asset?key=...` proxy URLs derived from storage keys.

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { withStorageControlTimeout, withStorageUploadTimeout } from "@/lib/storage-upload-timeout";

const BUCKET = "ai-assets";
const SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60;

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

export async function uploadAssets(args: {
  workspaceId: string;
  postId: string;
  images: ReadonlyArray<{ bytes: Buffer; mime: string }>;
}): Promise<UploadedAsset[]> {
  const sb = adminClient();
  const out: UploadedAsset[] = [];
  for (let i = 0; i < args.images.length; i++) {
    const img = args.images[i];
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
    out.push({ storageKey, signedUrl: data.signedUrl });
  }
  return out;
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
  const out: string[] = [];
  for (const key of storageKeys) {
    const { data, error } = await withStorageControlTimeout(
      sb.storage.from(BUCKET).createSignedUrl(key, SIGNED_URL_TTL_SECONDS),
      `AI asset re-sign ${key}`,
    );
    if (error || !data?.signedUrl) {
      throw new Error(`Re-sign failed for ${key}: ${error?.message || "unknown"}`);
    }
    out.push(data.signedUrl);
  }
  return out;
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
  const out: UploadedAsset[] = [];
  for (const a of args.assets) {
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
        out.push(a);
        continue;
      }
    }
    const { data, error: signErr } = await withStorageControlTimeout(
      sb.storage.from(BUCKET).createSignedUrl(newKey, SIGNED_URL_TTL_SECONDS),
      `AI asset re-sign ${newKey}`,
    );
    if (signErr || !data?.signedUrl) {
      // Move succeeded but re-sign failed — fall back to the old (now stale) URL.
      out.push({ storageKey: newKey, signedUrl: a.signedUrl });
      continue;
    }
    out.push({ storageKey: newKey, signedUrl: data.signedUrl });
  }
  return out;
}
