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

    // Not in workspace_members — look up their team_members row and provision.
    // SEC-010: lowercase the email and match with `.eq`. `.ilike` treated
    // wildcard chars in a crafted email as SQL patterns.
    const lookupEmail = (user.email ?? "").toLowerCase();
    const { data: tm } = await admin
      .from("team_members")
      .select("role, status")
      .eq("email", lookupEmail)
      .maybeSingle();

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
    const status = tm.status === "active" ? "active" : "pending";

    // SEC-018 / DATA-010: dual-tab race fix. Two simultaneous /provision
    // calls would both observe `existing = null` and both try to INSERT,
    // colliding on the unique (user_id, workspace_id) index. Use upsert
    // with ignoreDuplicates so the second writer no-ops cleanly.
    const { error: upsertErr } = await admin
      .from("workspace_members")
      .upsert(
        {
          workspace_id: BASELINE_WORKSPACE_ID,
          user_id: user.id,
          role,
          status,
        },
        { onConflict: "user_id,workspace_id", ignoreDuplicates: true },
      );
    if (upsertErr) {
      console.error("[workspace/provision] upsert error", upsertErr.message);
      return NextResponse.json({ error: "Provisioning failed" }, { status: 500 });
    }

    console.log(`[workspace/provision] Provisioned email_hash=${hashEmail(user.email)} as ${role} (${status})`);
    return NextResponse.json({ workspaceId: BASELINE_WORKSPACE_ID, provisioned: true });
  } catch (err: unknown) {
    // SEC-011: log the full error server-side, return a generic message.
    console.error("[workspace/provision]", err);
    return NextResponse.json({ error: "Provisioning failed" }, { status: 500 });
  }
}
