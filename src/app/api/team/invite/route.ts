import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getTransporter, getFromAddress, getSiteUrl, buildInviteEmailHtml } from "@/lib/email-utils";
import { requireBearerTeamRole } from "@/lib/auth/require";

export const maxDuration = 10;

const VALID_ROLES = ["admin", "approver", "creative_director", "social_media_specialist", "video_editor", "graphic_designer"] as const;
type ValidRole = (typeof VALID_ROLES)[number];

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase admin credentials not configured");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

/** Find an existing auth user by email using paginated listUsers */
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

async function hasOtherWorkspaceMembership(
  admin: ReturnType<typeof getAdminClient>,
  userId: string,
  workspaceId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userId);
  if (error) throw new Error(`Workspace membership check failed: ${error.message}`);
  return (data || []).some((row: { workspace_id?: string | null }) => row.workspace_id !== workspaceId);
}

interface InviteRequest {
  email: string;
  name: string;
  role: ValidRole;
  // requestedBy is no longer trusted; we derive the actor from the Bearer token
  // and only use this field as a hint for audit logging when present.
  requestedBy?: string;
}

export async function POST(request: NextRequest) {
  try {
    // ─── Auth: verified session, not client-supplied requestedBy ───
    const ctx = await requireBearerTeamRole(request, ["superadmin", "admin", "owner"]);
    if (ctx instanceof NextResponse) return ctx;
    const actorEmail = ctx.email;

    const body: InviteRequest = await request.json();

    // ─── Input validation ───
    if (!body.email || !body.name || !body.role) {
      return NextResponse.json({ error: "Missing required fields: email, name, role" }, { status: 400 });
    }

    const email = body.email.trim().toLowerCase();
    if (!/^[^\s@\r\n]+@[^\s@\r\n]+\.[^\s@\r\n]+$/.test(email)) {
      return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
    }

    if (!VALID_ROLES.includes(body.role)) {
      return NextResponse.json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(", ")}` }, { status: 400 });
    }

    const admin = getAdminClient();

    // ─── Check if email already exists in team ───
    const { data: existing } = await admin
      .from("team_members")
      .select("id")
      .eq("workspace_id", ctx.workspaceId)
      .eq("email", email)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ error: "This email is already a team member" }, { status: 409 });
    }

    // ─── Clean up any orphaned auth user (e.g. previously removed member) ───
    const existingAuthUser = await findAuthUserByEmail(admin, email);
    if (existingAuthUser) {
      const { error: workspaceCleanupErr } = await admin
        .from("workspace_members")
        .delete()
        .eq("user_id", existingAuthUser.id)
        .eq("workspace_id", ctx.workspaceId);
      if (workspaceCleanupErr) {
        console.error("[team/invite] orphan workspace cleanup failed:", workspaceCleanupErr.message);
        return NextResponse.json({ error: "Failed to clean up previous workspace access" }, { status: 500 });
      }
      if (await hasOtherWorkspaceMembership(admin, existingAuthUser.id, ctx.workspaceId)) {
        return NextResponse.json({ error: "That auth account belongs to another workspace" }, { status: 409 });
      }
      const { error: orphanAuthDeleteErr } = await admin.auth.admin.deleteUser(existingAuthUser.id);
      if (orphanAuthDeleteErr) {
        console.error("[team/invite] orphan auth cleanup failed:", orphanAuthDeleteErr.message);
        return NextResponse.json({ error: "Failed to clean up previous auth account" }, { status: 500 });
      }
    }

    // ─── Step 1: Create user silently with random temp password ───
    const tempPassword = crypto.randomUUID() + "!Aa1";
    const { data: authData, error: createErr } = await admin.auth.admin.createUser({
      email,
      password: tempPassword,
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
      if (authData?.user?.id) await admin.auth.admin.deleteUser(authData.user.id);
      return NextResponse.json({ error: "Failed to generate invite link" }, { status: 500 });
    }

    // ─── Step 3: Build our own confirmation URL ───
    const siteUrl = getSiteUrl();
    const tokenHash = linkData.properties.hashed_token;
    const confirmUrl = `${siteUrl}/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=invite`;

    // ─── Step 4: Insert team_members BEFORE email ───
    const { data: member, error: memberError } = await admin
      .from("team_members")
      .insert({
        workspace_id: ctx.workspaceId,
        name: body.name,
        email,
        role: body.role,
        status: "pending",
      })
      .select("id")
      .single();

    if (memberError) {
      console.error("[team/invite] team_members insert failed:", memberError.message);
      if (authData?.user?.id) await admin.auth.admin.deleteUser(authData.user.id);
      return NextResponse.json({ error: "Failed to register team member" }, { status: 500 });
    }

    // ─── Step 5: Send branded email via nodemailer ───
    let emailSent = false;
    let emailError = "";

    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;

    if (!smtpUser || !smtpPass) {
      emailError = "SMTP not configured — add SMTP_USER and SMTP_PASS to environment variables";
      console.error("[team/invite]", emailError);
    } else {
      try {
        const transporter = getTransporter();
        await transporter.sendMail({
          from: getFromAddress(),
          to: email,
          subject: `You're invited to join The Reach`,
          html: buildInviteEmailHtml(body.name, body.role, confirmUrl),
        });
        emailSent = true;
      } catch (err: unknown) {
        emailError = err instanceof Error ? err.message : "Unknown SMTP error";
        console.error("[team/invite] Email send failed:", emailError);
      }
    }

    // ─── Audit log ───
    try {
      await admin.rpc("record_audit_event", {
        p_entity_type: "team",
        p_action: "invite_sent",
        p_entity_id: null,
        p_workspace_id: ctx.workspaceId,
        p_metadata: {
          user_name: actorEmail,
          details: emailSent
            ? `Invited ${body.name} (${email}) as ${body.role} — email sent`
            : `Invited ${body.name} (${email}) as ${body.role} — email FAILED: ${emailError}. Invite link generated.`,
        },
      });
    } catch { /* audit log is best-effort */ }

    return NextResponse.json({
      success: true,
      memberId: member.id,
      email,
      emailSent,
      inviteUrl: emailSent ? undefined : confirmUrl,
      message: emailSent
        ? `Branded invite email sent to ${email}`
        : `User created but email failed: ${emailError}`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[team/invite]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
