import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getTransporter, getFromAddress, getSiteUrl, buildInviteEmailHtml } from "@/lib/email-utils";
import { requireBearerTeamRole } from "@/lib/auth/require";

export const maxDuration = 10;

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase admin credentials not configured");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function findAuthUserByEmail(admin: ReturnType<typeof getAdminClient>, email: string) {
  let page = 1;
  const perPage = 100;
  while (true) {
    const { data: { users }, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error || !users || users.length === 0) break;
    const found = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (found) return found;
    if (users.length < perPage) break;
    page++;
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    // ─── Auth: verified session, not client-supplied requestedBy ───
    const ctx = await requireBearerTeamRole(request, ["superadmin", "admin", "owner"]);
    if (ctx instanceof NextResponse) return ctx;
    const actorEmail = ctx.email;

    const body = await request.json();
    const { email, name, role } = body;

    if (!email || !name || !role) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    if (!/^[^\s@\r\n]+@[^\s@\r\n]+\.[^\s@\r\n]+$/.test(email)) {
      return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
    }

    const admin = getAdminClient();

    // Verify member exists and is pending
    const { data: member } = await admin
      .from("team_members")
      .select("id, status")
      .eq("email", email.trim().toLowerCase())
      .single();

    if (!member) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }
    if (member.status !== "pending") {
      return NextResponse.json({ error: "Member already active" }, { status: 409 });
    }

    // Delete old auth user
    const existingAuthUser = await findAuthUserByEmail(admin, email);
    if (existingAuthUser) {
      await admin.auth.admin.deleteUser(existingAuthUser.id);
    }

    // Create fresh auth user
    const tempPassword = crypto.randomUUID() + "!Aa1";
    const { data: authData, error: createErr } = await admin.auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password: tempPassword,
      email_confirm: false,
      user_metadata: { name, role },
    });

    if (createErr) {
      return NextResponse.json({ error: `Failed to create user: ${createErr.message}` }, { status: 500 });
    }

    // Generate new invite link
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "invite",
      email: email.trim().toLowerCase(),
      options: { data: { name, role } },
    });

    if (linkErr || !linkData?.properties?.hashed_token) {
      if (authData?.user?.id) await admin.auth.admin.deleteUser(authData.user.id);
      return NextResponse.json({ error: "Failed to generate invite link" }, { status: 500 });
    }

    const siteUrl = getSiteUrl();
    const tokenHash = linkData.properties.hashed_token;
    const confirmUrl = `${siteUrl}/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=invite`;

    // Send branded email
    let emailSent = false;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;

    if (smtpUser && smtpPass) {
      try {
        const transporter = getTransporter();
        await transporter.sendMail({
          from: getFromAddress(),
          to: email.trim().toLowerCase(),
          subject: `You're invited to join Ten80Ten`,
          html: buildInviteEmailHtml(name, role, confirmUrl),
        });
        emailSent = true;
      } catch (err: unknown) {
        console.error("[resend-invite] Email failed:", err instanceof Error ? err.message : err);
      }
    }

    // Audit log
    try {
      await admin.rpc("record_audit_event", {
        p_entity_type: "team",
        p_action: "invite_resent",
        p_entity_id: null,
        p_metadata: { user_name: actorEmail, details: `Resent invite to ${name} (${email})` },
      });
    } catch { /* best-effort */ }

    return NextResponse.json({
      success: true,
      emailSent,
      inviteUrl: emailSent ? undefined : confirmUrl,
      message: emailSent ? `Invite resent to ${email}` : "Email failed — invite link generated",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[resend-invite]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
