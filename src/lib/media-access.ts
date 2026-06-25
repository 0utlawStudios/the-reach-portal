import type { SupabaseClient } from "@supabase/supabase-js";

export const DRIVE_FILE_ID_RE = /^[a-zA-Z0-9_-]{20,80}$/;
const WORKSPACE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sourceReferencesValue(value: unknown, needle: string): boolean {
  if (typeof value === "string") return value.includes(needle);
  if (Array.isArray(value)) return value.some((item) => sourceReferencesValue(item, needle));
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((item) => sourceReferencesValue(item, needle));
  }
  return false;
}

export function parsePlaybackStorageKey(value: string | null | undefined): { key: string; workspaceId: string } | null {
  const key = (value || "").trim();
  if (
    !key ||
    key.length > 700 ||
    key.startsWith("/") ||
    key.includes("\\") ||
    key.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    return null;
  }
  const workspaceId = key.split("/")[0] || "";
  if (!WORKSPACE_ID_RE.test(workspaceId)) return null;
  return { key, workspaceId };
}

async function hasMediaAssetReference(
  admin: SupabaseClient,
  workspaceId: string | undefined,
  column: string,
  value: string,
  mode: "eq" | "ilike",
): Promise<boolean> {
  let query = admin.from("media_assets").select("id").limit(1);
  if (workspaceId) query = query.eq("workspace_id", workspaceId);
  query = mode === "eq" ? query.eq(column, value) : query.ilike(column, `%${value}%`);
  const { data, error } = await query;
  return !error && Boolean(data?.length);
}

async function hasPostColumnReference(
  admin: SupabaseClient,
  workspaceId: string | undefined,
  column: string,
  value: string,
): Promise<boolean> {
  let query = admin.from("posts").select("id").ilike(column, `%${value}%`).limit(1);
  if (workspaceId) query = query.eq("workspace_id", workspaceId);
  const { data, error } = await query;
  return !error && Boolean(data?.length);
}

async function hasSourceVaultReference(admin: SupabaseClient, workspaceId: string | undefined, value: string): Promise<boolean> {
  let query = admin
    .from("posts")
    .select("id, source_vault")
    .not("source_vault", "is", null)
    .limit(1000);
  if (workspaceId) query = query.eq("workspace_id", workspaceId);
  const { data, error } = await query;
  if (error || !data) return false;
  return data.some((row) => sourceReferencesValue(row.source_vault, value));
}

export async function isKnownAppDriveFile(
  admin: SupabaseClient | null,
  fileId: string,
  workspaceId?: string,
): Promise<boolean> {
  if (!admin || !DRIVE_FILE_ID_RE.test(fileId)) return false;

  const checks = await Promise.all([
    hasMediaAssetReference(admin, workspaceId, "file_id", fileId, "eq"),
    hasMediaAssetReference(admin, workspaceId, "url", fileId, "ilike"),
    hasMediaAssetReference(admin, workspaceId, "drive_proxy_url", fileId, "ilike"),
    hasMediaAssetReference(admin, workspaceId, "publish_url", fileId, "ilike"),
    hasMediaAssetReference(admin, workspaceId, "playback_url", fileId, "ilike"),
    hasPostColumnReference(admin, workspaceId, "thumbnail_url", fileId),
    hasSourceVaultReference(admin, workspaceId, fileId),
  ]);

  return checks.some(Boolean);
}

export async function isKnownPlaybackObject(
  admin: SupabaseClient | null,
  storageKey: string,
  workspaceId: string,
): Promise<boolean> {
  if (!admin || !parsePlaybackStorageKey(storageKey)) return false;

  const checks = await Promise.all([
    hasMediaAssetReference(admin, workspaceId, "playback_storage_key", storageKey, "eq"),
    hasMediaAssetReference(admin, workspaceId, "playback_url", storageKey, "ilike"),
    hasSourceVaultReference(admin, workspaceId, storageKey),
  ]);

  return checks.some(Boolean);
}
