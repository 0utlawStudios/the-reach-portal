import { NextRequest, NextResponse } from "next/server";
import { createClient, type User } from "@supabase/supabase-js";
import { getTransporter, getFromAddress, getSiteUrl, buildInviteEmailHtml } from "@/lib/email-utils";
import { requireBearerTeamRole } from "@/lib/auth/require";

export const maxDuration = 10;

const ACTIVE_ROLES = [
  "superadmin",
  "admin",
  "owner",
  "approver",
  "creative_director",
  "social_media_specialist",
  "video_editor",
  "graphic_designer",
  "editor",
  "viewer",
] as const;

const ADMIN_ROLES = new Set(["superadmin", "admin", "owner"]);
const INVITE_ROLES = new Set([
  "admin",
  "approver",
  "creative_director",
  "social_media_specialist",
  "video_editor",
  "graphic_designer",
]);

type AdminClient = ReturnType<typeof getAdminClient>;
type TeamMemberRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: "active" | "pending";
};

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase admin credentials not configured");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function normalizeEmail(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(value: string): boolean {
  return /^[^\s@\r\n]+@[^\s@\r\n]+\.[^\s@\r\n]+$/.test(value);
}

async function findAuthUserByEmail(admin: AdminClient, email: string): Promise<User | null> {
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

async function sendInviteEmail(email: string, member: TeamMemberRow, confirmUrl: string) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return { sent: false, error: "SMTP not configured" };
  }
  try {
    const transporter = getTransporter();
    await transporter.sendMail({
      from: getFromAddress(),
      to: email,
      subject: "You're invited to join The Reach",
      html: buildInviteEmailHtml(member.name, member.role, confirmUrl),
    });
    return { sent: true, error: "" };
  } catch (err: unknown) {
    return { sent: false, error: err instanceof Error ? err.message : "Unknown SMTP error" };
  }
}

async function auditEmailChange(admin: AdminClient, workspaceId: string, actorEmail: string, member: TeamMemberRow, oldEmail: string, newEmail: string) {
  try {
    await admin.rpc("record_audit_event", {
      p_entity_type: "team",
      p_action: "member_email_changed",
      p_entity_id: null,
      p_workspace_id: workspaceId,
      p_metadata: {
        user_name: actorEmail,
        details: `${member.name}'s email changed from ${oldEmail} to ${newEmail}`,
      },
    });
  } catch {
    // Audit is best-effort. The Auth/team reconciliation above is authoritative.
  }
}

async function updateActiveMemberEmail(admin: AdminClient, workspaceId: string, authUser: User, member: TeamMemberRow, newEmail: string, actorEmail: string) {
  const oldEmail = member.email.toLowerCase();
  const previousMetadata = authUser.user_metadata || {};

  const { error: authUpdateErr } = await admin.auth.admin.updateUserById(authUser.id, {
    email: newEmail,
    email_confirm: true,
    user_metadata: {
      ...previousMetadata,
      name: member.name,
      role: member.role,
    },
  });
  if (authUpdateErr) {
    return NextResponse.json({ error: `Auth email update failed: ${authUpdateErr.message}` }, { status: 500 });
  }

  const rollbackAuth = async () => {
    await admin.auth.admin.updateUserById(authUser.id, {
      email: oldEmail,
      email_confirm: true,
      user_metadata: previousMetadata,
    });
  };

  const { error: memberErr } = await admin
    .from("team_members")
    .update({ email: newEmail })
    .eq("id", member.id);
  if (memberErr) {
    await rollbackAuth();
    return NextResponse.json({ error: "Team profile update failed; Auth email was rolled back." }, { status: 500 });
  }

  const updates = [
    admin.from("support_threads").update({ created_by_email: newEmail }).eq("created_by", authUser.id),
    admin.from("posts").update({ created_by: member.name }).eq("created_by", oldEmail),
    admin.from("media_assets").update({ added_by: member.name }).eq("added_by", oldEmail),
  ];
  const results = await Promise.all(updates);
  const failed = results.find((result) => result.error);
  if (failed?.error) {
    await admin.from("team_members").update({ email: oldEmail }).eq("id", member.id);
    await rollbackAuth();
    return NextResponse.json({ error: "App identity reconciliation failed; Auth email was rolled back." }, { status: 500 });
  }

  await auditEmailChange(admin, workspaceId, actorEmail, member, oldEmail, newEmail);
  return NextResponse.json({
    success: true,
    email: newEmail,
    requiresSignIn: true,
    message: "Email changed. Sign back in with the new email.",
  });
}

async function updatePendingInviteEmail(admin: AdminClient, workspaceId: string, member: TeamMemberRow, oldAuthUser: User | null, newEmail: string, actorEmail: string) {
  const oldEmail = member.email.toLowerCase();
  const tempPassword = crypto.randomUUID() + "!Aa1";
  const { data: authData, error: createErr } = await admin.auth.admin.createUser({
    email: newEmail,
    password: tempPassword,
    email_confirm: false,
    user_metadata: { name: member.name, role: member.role },
  });
  if (createErr) {
    return NextResponse.json({ error: `Failed to create invite user: ${createErr.message}` }, { status: 500 });
  }

  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "invite",
    email: newEmail,
    options: { data: { name: member.name, role: member.role } },
  });
  if (linkErr || !linkData?.properties?.hashed_token) {
    if (authData?.user?.id) await admin.auth.admin.deleteUser(authData.user.id);
    return NextResponse.json({ error: "Failed to generate invite link" }, { status: 500 });
  }

  const { error: memberErr } = await admin
    .from("team_members")
    .update({ email: newEmail, name: member.name, role: member.role })
    .eq("id", member.id);
  if (memberErr) {
    if (authData?.user?.id) await admin.auth.admin.deleteUser(authData.user.id);
    return NextResponse.json({ error: "Team invite email update failed" }, { status: 500 });
  }

  if (oldAuthUser?.id) {
    await admin.from("workspace_members").delete().eq("user_id", oldAuthUser.id);
    await admin.auth.admin.deleteUser(oldAuthUser.id);
  }

  const confirmUrl = `${getSiteUrl()}/auth/confirm?token_hash=${encodeURIComponent(linkData.properties.hashed_token)}&type=invite`;
  const emailResult = await sendInviteEmail(newEmail, member, confirmUrl);
  await auditEmailChange(admin, workspaceId, actorEmail, member, oldEmail, newEmail);

  return NextResponse.json({
    success: true,
    email: newEmail,
    emailSent: emailResult.sent,
    inviteUrl: emailResult.sent ? undefined : confirmUrl,
    message: emailResult.sent
      ? `Invite email updated and sent to ${newEmail}`
      : `Invite email updated. Email not sent: ${emailResult.error}`,
  });
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireBearerTeamRole(request, ACTIVE_ROLES);
    if (ctx instanceof NextResponse) return ctx;

    const body = await request.json();
    const memberId = String(body.memberId || "").trim();
    const newEmail = normalizeEmail(body.newEmail);
    const requestedName = String(body.name || "").trim();
    const requestedRole = String(body.role || "").trim();

    if (!memberId || !newEmail) {
      return NextResponse.json({ error: "Missing required fields: memberId, newEmail" }, { status: 400 });
    }
    if (!isValidEmail(newEmail)) {
      return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
    }

    const admin = getAdminClient();
    const { data: member, error: memberReadErr } = await admin
      .from("team_members")
      .select("id, name, email, role, status")
      .eq("id", memberId)
      .maybeSingle();
    if (memberReadErr) {
      return NextResponse.json({ error: "Could not read team member" }, { status: 500 });
    }
    if (!member) {
      return NextResponse.json({ error: "Team member not found" }, { status: 404 });
    }

    const target = member as TeamMemberRow;
    const oldEmail = normalizeEmail(target.email);
    if (!isValidEmail(oldEmail)) {
      return NextResponse.json({ error: "Current member email is invalid" }, { status: 409 });
    }
    if (oldEmail === newEmail) {
      return NextResponse.json({ success: true, email: newEmail, unchanged: true });
    }

    const { data: duplicateMember } = await admin
      .from("team_members")
      .select("id")
      .eq("email", newEmail)
      .maybeSingle();
    if (duplicateMember && (duplicateMember as { id: string }).id !== target.id) {
      return NextResponse.json({ error: "That email is already a team member" }, { status: 409 });
    }

    const oldAuthUser = await findAuthUserByEmail(admin, oldEmail);
    const newAuthUser = await findAuthUserByEmail(admin, newEmail);
    if (newAuthUser && newAuthUser.id !== oldAuthUser?.id) {
      return NextResponse.json({ error: "That email already has an auth account" }, { status: 409 });
    }

    const isAdminActor = ADMIN_ROLES.has(ctx.role.toLowerCase());
    const isSelf = !!oldAuthUser?.id && oldAuthUser.id === ctx.user.id;

    if (target.status === "active") {
      if (!oldAuthUser) {
        return NextResponse.json({ error: "Active member is missing a matching auth user" }, { status: 409 });
      }
      if (!isSelf) {
        return NextResponse.json({ error: "Active members must change their own email while signed in." }, { status: 409 });
      }
      return updateActiveMemberEmail(admin, ctx.workspaceId, oldAuthUser, target, newEmail, ctx.email);
    }

    if (!isAdminActor) {
      return NextResponse.json({ error: "Only admins can change pending invite emails" }, { status: 403 });
    }
    if (target.role === "superadmin" && ctx.role !== "superadmin") {
      return NextResponse.json({ error: "Only a superadmin can change a superadmin invite email" }, { status: 403 });
    }

    const pendingTarget = { ...target };
    if (requestedName) pendingTarget.name = requestedName;
    if (requestedRole) {
      if (!INVITE_ROLES.has(requestedRole)) {
        return NextResponse.json({ error: "Invalid pending invite role" }, { status: 400 });
      }
      pendingTarget.role = requestedRole;
    }

    return updatePendingInviteEmail(admin, ctx.workspaceId, pendingTarget, oldAuthUser, newEmail, ctx.email);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[team/change-email]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
