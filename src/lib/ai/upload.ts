// Upload processed images to the private `ai-assets` Supabase bucket and
// hand back signed URLs the client can render directly. URLs expire in 7
// days; the kanban card fetcher will refresh them when within 24h of expiry.

import { createClient, SupabaseClient } from "@supabase/supabase-js";

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
    const { error: upErr } = await sb.storage.from(BUCKET).upload(storageKey, img.bytes, {
      contentType: img.mime,
      upsert: true,
    });
    if (upErr) throw new Error(`Upload failed for ${storageKey}: ${upErr.message}`);
    const { data, error: signErr } = await sb.storage.from(BUCKET).createSignedUrl(storageKey, SIGNED_URL_TTL_SECONDS);
    if (signErr || !data?.signedUrl) {
      throw new Error(`Signed URL failed for ${storageKey}: ${signErr?.message || "unknown"}`);
    }
    out.push({ storageKey, signedUrl: data.signedUrl });
  }
  return out;
}

/**
 * Re-sign storage keys. Used by the post-fetch path when an existing signed
 * URL is within 24h of expiry.
 */
export async function resignAssets(
  storageKeys: ReadonlyArray<string>,
): Promise<string[]> {
  const sb = adminClient();
  const out: string[] = [];
  for (const key of storageKeys) {
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(key, SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) {
      throw new Error(`Re-sign failed for ${key}: ${error?.message || "unknown"}`);
    }
    out.push(data.signedUrl);
  }
  return out;
}
