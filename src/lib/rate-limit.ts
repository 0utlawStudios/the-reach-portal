import { createClient } from "@supabase/supabase-js";

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
};

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase admin credentials not configured");
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

type RpcRow = {
  allowed: boolean;
  remaining: number;
  reset_at: string;
};

/**
 * Consume one token from a named rate-limit bucket.
 * Scope identifies the endpoint (e.g., "forgot-password"), key identifies the
 * caller (usually an IP address or a user id). Backed by the rate_limit_buckets
 * table and the rate_limit_consume RPC.
 *
 * Fails open on any infrastructure error: returns allowed=true so an outage in
 * the rate limit system does not take down the endpoint it protects.
 */
export async function consume(
  scope: string,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const fallbackReset = new Date(Date.now() + windowSeconds * 1000);
  try {
    const admin = getAdminClient();
    const { data, error } = await admin.rpc("rate_limit_consume", {
      p_scope: scope,
      p_key: key,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error) {
      console.error("[rate-limit] rpc error", { scope, key, message: error.message });
      return { allowed: true, remaining: limit, resetAt: fallbackReset };
    }
    const row: RpcRow | undefined = Array.isArray(data) ? data[0] : (data as RpcRow | undefined);
    if (!row) {
      return { allowed: true, remaining: limit, resetAt: fallbackReset };
    }
    return {
      allowed: !!row.allowed,
      remaining: Number(row.remaining) || 0,
      resetAt: row.reset_at ? new Date(row.reset_at) : fallbackReset,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[rate-limit] exception", { scope, key, message });
    return { allowed: true, remaining: limit, resetAt: fallbackReset };
  }
}

/**
 * Extract a stable client key from a Next.js route handler Request.
 * Prefers Cloudflare, then X-Forwarded-For (first entry), then X-Real-IP.
 */
export function getClientIp(req: Request): string {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || "unknown";
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}
