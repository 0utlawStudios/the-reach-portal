// POST /api/admin/publish-jobs/[id]/retry
//
// Admin-only. Resets a publish_jobs row to a clean pending state so the
// next n8n claim picks it up: state=pending, attempts=0, next_retry_at=null,
// last_error=null, worker_id=null, claim_expires_at=null.
//
// Use cases:
//   - A transient platform outage chewed through 3 attempts and dead-lettered
//     the job. The operator wants to re-arm it after the platform recovers.
//   - A claim got stuck (worker crashed; claim_expires_at in the past) and the
//     operator wants to release it immediately rather than wait for the
//     stuck-reclaim sweep.
//
// Auth: requireBearerTeamRole(superadmin, admin, owner). Returns 401/403 for
// anyone else. Audit-logged via record_audit_event.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireBearerTeamRole } from "@/lib/auth/require";

export const maxDuration = 10;

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase admin credentials not configured");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function isValidUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireBearerTeamRole(request, ["superadmin", "admin", "owner"]);
    if (auth instanceof NextResponse) return auth;

    const { id } = await ctx.params;
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: "Invalid job id" }, { status: 400 });
    }

    const admin = adminClient();
    const { data, error } = await admin
      .from("publish_jobs")
      .update({
        state: "pending",
        attempts: 0,
        next_retry_at: null,
        last_error: null,
        worker_id: null,
        claim_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("id, post_id, state")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Audit. Best-effort — don't fail the retry if the audit write fails.
    try {
      await admin.from("audit_log_v2").insert({
        actor_user_id: null,
        actor_role: "n8n",
        entity_type: "post",
        entity_id: data.post_id,
        action: "publish_job_force_retried",
        metadata: {
          user_name: auth.email,
          job_id: id,
          details: `Force-retried by ${auth.email}; state reset to pending, attempts=0`,
        },
      });
    } catch (err) {
      console.error("[admin/publish-jobs/retry] audit write failed:", err);
    }

    return NextResponse.json({ success: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[admin/publish-jobs/retry]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
