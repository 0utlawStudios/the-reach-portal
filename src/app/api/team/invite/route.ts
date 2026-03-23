import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const maxDuration = 10;

const VALID_ROLES = ["admin", "editor", "viewer", "specialist", "technician", "developer"] as const;
type ValidRole = (typeof VALID_ROLES)[number];

// Admin Supabase client — uses SERVICE_ROLE_KEY, never exposed to frontend
function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase admin credentials not configured");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

interface InviteRequest {
  email: string;
  name: string;
  role: ValidRole;
  requestedBy: string; // email of the requesting user
}

export async function POST(request: NextRequest) {
  try {
    const body: InviteRequest = await request.json();

    // ─── Input validation ───
    if (!body.email || !body.name || !body.role || !body.requestedBy) {
      return NextResponse.json({ error: "Missing required fields: email, name, role, requestedBy" }, { status: 400 });
    }

    const email = body.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
    }

    if (!VALID_ROLES.includes(body.role)) {
      return NextResponse.json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(", ")}` }, { status: 400 });
    }

    const admin = getAdminClient();

    // ─── RBAC: Verify requester is owner or admin ───
    const { data: requester, error: requesterErr } = await admin
      .from("team_members")
      .select("role")
      .eq("email", body.requestedBy)
      .single();

    if (requesterErr || !requester) {
      return NextResponse.json({ error: "Unauthorized — requester not found in team" }, { status: 403 });
    }

    if (requester.role !== "owner" && requester.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized — only owners and admins can invite members" }, { status: 403 });
    }

    // ─── Check if email already exists in team ───
    const { data: existing } = await admin
      .from("team_members")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ error: "This email is already a team member" }, { status: 409 });
    }

    // ─── Send magic link invite via Supabase Auth ───
    const { data: authData, error: authError } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { name: body.name, role: body.role },
    });

    if (authError) {
      console.error("[team/invite] Auth invite failed:", authError.message);
      return NextResponse.json({ error: `Invite failed: ${authError.message}` }, { status: 500 });
    }

    // ─── Sync to team_members table ───
    const { data: member, error: memberError } = await admin
      .from("team_members")
      .insert({
        name: body.name,
        email,
        role: body.role,
        status: "pending",
      })
      .select("id")
      .single();

    if (memberError) {
      console.error("[team/invite] team_members insert failed:", memberError.message);
      // Auth user was created but team_members insert failed — clean up
      if (authData?.user?.id) {
        await admin.auth.admin.deleteUser(authData.user.id);
      }
      return NextResponse.json({ error: "Failed to register team member" }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      memberId: member.id,
      email,
      message: `Secure invite link sent to ${email}`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[team/invite]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
