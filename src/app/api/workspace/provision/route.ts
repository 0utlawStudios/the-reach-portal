import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";

// Self-healing workspace provisioner.
// Called on every app load. If the authenticated user has a team_members row
// but is missing from workspace_members (e.g., migration 0003 not yet applied,
// or added after the seed ran), this inserts them automatically using the
// service role so the chicken-and-egg RLS dependency is broken.

export const maxDuration = 10;

const BASELINE_WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const WORKSPACE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase admin credentials not configured");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

// SEC-014: Hash the email before logging. Cleartext emails in server logs
// turn into a credential-stuffing target if the log store leaks.
function hashEmail(email: string | null | undefined): string {
  return createHash("sha256").update(email || "").digest("hex").slice(0, 12);
}

function workspaceIdFromHeaders(headers: Headers): string | null | NextResponse {
  const raw = headers.get("x-workspace-id") || headers.get("x-reach-workspace-id") || "";
  const workspaceId = raw.trim();
  if (!workspaceId) return null;
  if (!WORKSPACE_ID_RE.test(workspaceId)) {
    return NextResponse.json({ error: "Invalid workspace context" }, { status: 400 });
  }
  return workspaceId;
}

export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get("Authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const admin = getAdminClient();

    const { data: { user }, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const requestedWorkspaceId = workspaceIdFromHeaders(request.headers);
    if (requestedWorkspaceId instanceof NextResponse) return requestedWorkspaceId;

    // Check if user already has a workspace membership. Pending rows are not
    // usable access, but we must see them so activation can promote the same row
    // instead of colliding with the primary key.
    let workspaceQuery = admin
      .from("workspace_members")
      .select("workspace_id, status")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (requestedWorkspaceId) {
      workspaceQuery = workspaceQuery.eq("workspace_id", requestedWorkspaceId);
    }
    const { data: existingRows, error: existingErr } = await workspaceQuery.limit(2);
    if (existingErr) {
      console.error("[workspace/provision] membership read error", existingErr.message);
      return NextResponse.json({ error: "Provisioning failed" }, { status: 500 });
    }
    const rows = existingRows || [];
    const activeRows = rows.filter((row) => row.status === "active");
    if (!requestedWorkspaceId && activeRows.length > 1) {
      return NextResponse.json({ error: "Workspace context required" }, { status: 409 });
    }
    const existing = activeRows[0] || rows[0] || null;

    if (existing?.status === "active") {
      return NextResponse.json({ workspaceId: existing.workspace_id });
    }

    // Not in workspace_members — look up their team_members row and provision.
    // SEC-010: lowercase the email and match with `.eq`. `.ilike` treated
    // wildcard chars in a crafted email as SQL patterns.
    const lookupEmail = (user.email ?? "").toLowerCase();
    let teamQuery = admin
      .from("team_members")
      .select("workspace_id, role, status")
      .eq("email", lookupEmail);
    if (requestedWorkspaceId) {
      teamQuery = teamQuery.eq("workspace_id", requestedWorkspaceId);
    } else if (existing?.workspace_id) {
      teamQuery = teamQuery.eq("workspace_id", existing.workspace_id);
    }
    const { data: teamRows, error: teamErr } = await teamQuery
      .order("created_at", { ascending: false })
      .limit(2);
    if (teamErr) {
      console.error("[workspace/provision] team read error", teamErr.message);
      return NextResponse.json({ error: "Provisioning failed" }, { status: 500 });
    }
    if (!requestedWorkspaceId && !existing?.workspace_id && (teamRows?.length || 0) > 1) {
      return NextResponse.json({ error: "Workspace context required" }, { status: 409 });
    }
    const tm = teamRows?.[0] || null;

    // SEC-006: REJECT users without a team_members row instead of silently
    // creating a pending editor. The previous behavior turned the
    // provisioner into a self-service signup endpoint: anyone who could
    // authenticate to Supabase auth would get an editor row and the
    // approval queue. Now: no team_members row → 403.
    if (!tm) {
      return NextResponse.json({ error: "Not on team" }, { status: 403 });
    }

    const role = tm.role as string;
    if (!role) {
      // team_members row exists but role is empty — treat as misconfigured,
      // not as a permission upgrade.
      return NextResponse.json({ error: "Not on team" }, { status: 403 });
    }
    if (tm.status !== "active") {
      // A pending invite has an auth session but must not receive domain-table
      // access yet. Returning a workspaceId here makes the client render a fake
      // empty workspace because RLS correctly hides posts/media/team rows.
      return NextResponse.json(
        { error: "Workspace access pending. Complete invite setup first.", status: "pending" },
        { status: 403 },
      );
    }
    const workspaceId = (tm.workspace_id as string | null) || requestedWorkspaceId || existing?.workspace_id || BASELINE_WORKSPACE_ID;

    // SEC-018 / DATA-010: dual-tab race fix. Two simultaneous /provision
    // calls would both observe no active membership and both try to INSERT,
    // colliding on the workspace/user primary key. Use upsert without
    // ignoreDuplicates so a stale pending row is promoted to active.
    const { error: upsertErr } = await admin
      .from("workspace_members")
      .upsert(
        {
          workspace_id: workspaceId,
          user_id: user.id,
          role,
          status: "active",
        },
        { onConflict: "workspace_id,user_id" },
      );
    if (upsertErr) {
      console.error("[workspace/provision] upsert error", upsertErr.message);
      return NextResponse.json({ error: "Provisioning failed" }, { status: 500 });
    }

    console.log(`[workspace/provision] Provisioned email_hash=${hashEmail(user.email)} as ${role} (active)`);
    return NextResponse.json({ workspaceId, provisioned: true });
  } catch (err: unknown) {
    // SEC-011: log the full error server-side, return a generic message.
    console.error("[workspace/provision]", err);
    return NextResponse.json({ error: "Provisioning failed" }, { status: 500 });
  }
}
