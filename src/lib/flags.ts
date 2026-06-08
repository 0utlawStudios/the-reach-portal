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

const cache = new Map<FlagName, CacheEntry>();
const TTL_MS = 30_000;

export async function isFlagOn(name: FlagName): Promise<boolean> {
  const cached = cache.get(name);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;

  const { data, error } = await supabase
    .from("feature_flags")
    .select("enabled")
    .eq("name", name)
    .maybeSingle();

  if (error) {
    console.error("flag read failed", name, error);
    return false;
  }

  const value = Boolean(data?.enabled);
  cache.set(name, { value, at: Date.now() });
  return value;
}

export function invalidateFlagCache(name?: FlagName) {
  if (name) cache.delete(name);
  else cache.clear();
}
