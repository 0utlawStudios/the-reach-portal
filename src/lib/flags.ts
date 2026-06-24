import { supabase } from "./supabaseClient";

export type FlagName =
  | "rls_v2"
  | "server_auth_v2"
  | "server_rpc_writes"
  | "drive_auth_v2"
  | "publish_v2"
  | "media_v2"
  | "audit_v2"
  | "content_validation_v2"
  | "manual_posted_moves";

type CacheEntry = { value: boolean; at: number };

const cache = new Map<string, CacheEntry>();
const TTL_MS = 30_000;
const BASELINE_WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";

function cacheKey(name: FlagName, workspaceId?: string): string {
  return `${workspaceId || BASELINE_WORKSPACE_ID}:${name}`;
}

export async function isFlagOn(name: FlagName, workspaceId?: string): Promise<boolean> {
  const key = cacheKey(name, workspaceId);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;

  const resolvedWorkspaceId = workspaceId || BASELINE_WORKSPACE_ID;
  const query = supabase
    .from("feature_flags")
    .select("enabled")
    .eq("workspace_id", resolvedWorkspaceId)
    .eq("name", name);
  const { data, error } = await query.maybeSingle();

  if (error) {
    console.error("flag read failed", name, error);
    return false;
  }

  const value = Boolean(data?.enabled);
  cache.set(key, { value, at: Date.now() });
  return value;
}

export function invalidateFlagCache(name?: FlagName) {
  if (!name) {
    cache.clear();
    return;
  }
  for (const key of Array.from(cache.keys())) {
    if (key.endsWith(`:${name}`)) cache.delete(key);
  }
}
