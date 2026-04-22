import { supabase } from "./supabaseClient";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

interface EnsureMediaAssetParams {
  name: string;
  url: string;
  fileType: "image" | "video";
  folder: string;
  addedBy: string;
  workspaceId: string;
  usedIn?: string; // post UUID — only set when the post has a real UUID, not a temp timestamp
}

/**
 * Insert a media asset row if one doesn't already exist for this URL.
 * If a row already exists and a valid post UUID is provided, appends the
 * post ID to the `used_in` array. Safe to call multiple times — idempotent.
 */
export async function ensureMediaAsset(params: EnsureMediaAssetParams): Promise<void> {
  const { name, url, fileType, folder, addedBy, workspaceId, usedIn } = params;
  const wsId = workspaceId || "00000000-0000-0000-0000-000000000001";

  // 1. Check if a row with this URL already exists
  const { data: existing } = await supabase
    .from("media_assets")
    .select("id, used_in")
    .eq("url", url)
    .maybeSingle();

  if (existing) {
    // Row exists — only update used_in if we have a real post UUID to add
    if (usedIn && isValidUuid(usedIn)) {
      const currentUsedIn: string[] = existing.used_in || [];
      if (!currentUsedIn.includes(usedIn)) {
        await supabase
          .from("media_assets")
          .update({ used_in: [...currentUsedIn, usedIn] })
          .eq("id", existing.id);
      }
    }
    return;
  }

  // 2. Insert new row
  const usedInArray = usedIn && isValidUuid(usedIn) ? [usedIn] : [];
  const { error } = await supabase.from("media_assets").insert({
    name,
    url,
    file_type: fileType,
    folder,
    added_by: addedBy,
    workspace_id: wsId,
    used_in: usedInArray,
  });

  if (error) {
    console.error("[media-assets] ensureMediaAsset failed:", error.message);
  }
}
