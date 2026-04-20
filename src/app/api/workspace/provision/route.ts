import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Self-healing workspace provisioner.
// Called on every app load. If the authenticated user has a team_members row
// but is missing from workspace_members (e.g., migration 0003 not yet applied,
// or added after the seed ran), this inserts them automatically using the
// service role so the chicken-and-egg RLS dependency is broken.

export const maxDuration = 10;

const BASELINE_WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase admin credentials not configured");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get("Authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const admin = getAdminClient();

    const { data: { user }, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Check if user is already an active workspace member
    const { data: existing } = await admin
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", user.id)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ workspaceId: existing.workspace_id });
    }

    // Not in workspace_members — look up their team_members row and provision
    const { data: tm } = await admin
      .from("team_members")
      .select("role, status")
      .ilike("email", user.email ?? "")
      .maybeSingle();

    const role = (tm?.role as string) || "editor";
    const status = tm?.status === "active" ? "active" : "pending";

    await admin.from("workspace_members").insert({
      workspace_id: BASELINE_WORKSPACE_ID,
      user_id: user.id,
      role,
      status,
    });

    console.log(`[workspace/provision] Provisioned ${user.email} as ${role} (${status})`);
    return NextResponse.json({ workspaceId: BASELINE_WORKSPACE_ID, provisioned: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[workspace/provision]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
