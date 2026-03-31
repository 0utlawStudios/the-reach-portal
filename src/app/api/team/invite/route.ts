import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getTransporter, getFromAddress, getSiteUrl, buildInviteEmailHtml } from "@/lib/email-utils";

export const maxDuration = 10;

const VALID_ROLES = ["admin", "editor", "viewer", "specialist", "technician", "developer"] as const;
type ValidRole = (typeof VALID_ROLES)[number];

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
  requestedBy: string;
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

    // ─── RBAC: Verify requester is superadmin, developer, or admin ───
    const { data: requester, error: requesterErr } = await admin
      .from("team_members")
      .select("role")
      .eq("email", body.requestedBy)
      .single();

    if (requesterErr || !requester) {
      return NextResponse.json({ error: "Unauthorized — requester not found in team" }, { status: 403 });
    }

    if (!["superadmin", "developer", "admin"].includes(requester.role)) {
      return NextResponse.json({ error: "Unauthorized — only superadmins, developers, and admins can invite members" }, { status: 403 });
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

    // ─── Step 1: Create user silently (no email sent) ───
    const { data: authData, error: createErr } = await admin.auth.admin.createUser({
      email,
      email_confirm: false,
      user_metadata: { name: body.name, role: body.role },
    });

    if (createErr) {
      console.error("[team/invite] createUser failed:", createErr.message);
      return NextResponse.json({ error: `Failed to create user: ${createErr.message}` }, { status: 500 });
    }

    // ─── Step 2: Generate invite link (no email sent) ───
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "invite",
      email,
      options: { data: { name: body.name, role: body.role } },
    });

    if (linkErr || !linkData?.properties?.hashed_token) {
      console.error("[team/invite] generateLink failed:", linkErr?.message);
      // Rollback: delete the auth user
      if (authData?.user?.id) await admin.auth.admin.deleteUser(authData.user.id);
      return NextResponse.json({ error: "Failed to generate invite link" }, { status: 500 });
    }

    // ─── Step 3: Build our own confirmation URL ───
    const siteUrl = getSiteUrl();
    const tokenHash = linkData.properties.hashed_token;
    const confirmUrl = `${siteUrl}/auth/confirm?token_hash=${tokenHash}&type=invite`;

    // ─── Step 4: Send branded email via nodemailer ───
    try {
      const transporter = getTransporter();
      await transporter.sendMail({
        from: getFromAddress(),
        to: email,
        subject: `You're invited to join Ten80Ten`,
        html: buildInviteEmailHtml(body.name, body.role, confirmUrl),
      });
    } catch (emailErr: any) {
      console.error("[team/invite] Email send failed:", emailErr?.message);
      // Rollback: delete the auth user
      if (authData?.user?.id) await admin.auth.admin.deleteUser(authData.user.id);
      return NextResponse.json({ error: "Failed to send invite email" }, { status: 500 });
    }

    // ─── Step 5: Sync to team_members table ───
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
      // Rollback: delete auth user
      if (authData?.user?.id) await admin.auth.admin.deleteUser(authData.user.id);
      return NextResponse.json({ error: "Failed to register team member" }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      memberId: member.id,
      email,
      message: `Branded invite email sent to ${email}`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[team/invite]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
