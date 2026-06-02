import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";

export const dynamic = "force-dynamic";

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function bearer(req: Request): string {
  return req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() || "";
}

export async function GET(req: Request) {
  const cronSecret = (process.env.CRON_SECRET || "").trim();
  const healthSecret = (process.env.HEALTH_CHECK_SECRET || "").trim();
  const token = bearer(req);
  const headerHealthToken = req.headers.get("x-health-token")?.trim() || "";
  const authorized =
    (cronSecret && token && safeEqual(token, cronSecret)) ||
    (healthSecret && token && safeEqual(token, healthSecret)) ||
    (healthSecret && headerHealthToken && safeEqual(headerHealthToken, healthSecret));

  if (!authorized) return unauthorized();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "Supabase admin credentials not configured" }, { status: 500 });
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const [workspace, posts, media, audit] = await Promise.all([
    admin.from("workspaces").select("id", { head: true, count: "exact" }).limit(1),
    admin.from("posts").select("id", { head: true, count: "exact" }).limit(1),
    admin.from("media_assets").select("id", { head: true, count: "exact" }).limit(1),
    admin.from("audit_log_v2").select("id", { head: true, count: "exact" }).limit(1),
  ]);

  const failures = [
    ["workspaces", workspace.error],
    ["posts", posts.error],
    ["media_assets", media.error],
    ["audit_log_v2", audit.error],
  ].filter(([, error]) => Boolean(error));

  if (failures.length > 0) {
    return NextResponse.json({
      ok: false,
      timestamp: new Date().toISOString(),
      failures: failures.map(([table, error]) => ({
        table,
        error: error instanceof Error ? error.message : String((error as { message?: string } | null)?.message || error),
      })),
    }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    timestamp: new Date().toISOString(),
    counts: {
      workspaces: workspace.count,
      posts: posts.count,
      mediaAssets: media.count,
      auditEvents: audit.count,
    },
  });
}
