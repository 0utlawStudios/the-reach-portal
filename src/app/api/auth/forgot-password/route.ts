import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  getTransporter,
  getFromAddress,
  getSiteUrl,
  buildInviteEmailHtml,
  buildPasswordResetEmailHtml,
} from "@/lib/email-utils";
import { consume, getClientIp } from "@/lib/rate-limit";

export const maxDuration = 10;
const WORKSPACE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase admin credentials not configured");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function sendRecoveryEmail(email: string, confirmUrl: string) {
  const transporter = getTransporter();
  await transporter.sendMail({
    from: getFromAddress(),
    to: email,
    subject: "Reset your password for The Reach",
    html: buildPasswordResetEmailHtml(confirmUrl),
  });
}

async function sendSetupEmail(email: string, name: string, role: string, confirmUrl: string) {
  const transporter = getTransporter();
  await transporter.sendMail({
    from: getFromAddress(),
    to: email,
    subject: "Set up your account for The Reach",
    html: buildInviteEmailHtml(name, role, confirmUrl),
  });
}

type ForgotPasswordBody = {
  email?: unknown;
  workspaceId?: unknown;
  workspaceSlug?: unknown;
  workspace?: unknown;
};

type TeamMemberAccess = {
  name: string | null;
  role: string | null;
  status: string | null;
};

async function resolveWorkspaceId(
  admin: ReturnType<typeof getAdminClient>,
  request: NextRequest,
  body: ForgotPasswordBody,
): Promise<string> {
  const explicitId = (typeof body.workspaceId === "string" ? body.workspaceId : request.headers.get("x-workspace-id") || "").trim();
  const slugOrAlias = (
    typeof body.workspaceSlug === "string" ? body.workspaceSlug
      : typeof body.workspace === "string" ? body.workspace
        : request.headers.get("x-workspace-slug") || ""
  ).trim();
  const workspaceId = explicitId || (WORKSPACE_ID_RE.test(slugOrAlias) ? slugOrAlias : "");
  const workspaceSlug = workspaceId ? "" : slugOrAlias;
  if (!workspaceId && !workspaceSlug) throw new Error("Workspace context required");
  if (workspaceId && !WORKSPACE_ID_RE.test(workspaceId)) throw new Error("Invalid workspace");

  const query = admin
    .from("workspaces")
    .select("id")
    .limit(1);
  const { data, error } = workspaceId
    ? await query.eq("id", workspaceId).maybeSingle<{ id: string }>()
    : await query.eq("slug", workspaceSlug).maybeSingle<{ id: string }>();
  if (error || !data?.id) throw new Error("Workspace not found");
  return data.id;
}

function hasWorkspaceContext(request: NextRequest, body: ForgotPasswordBody): boolean {
  return Boolean(
    (typeof body.workspaceId === "string" && body.workspaceId.trim()) ||
    (typeof body.workspaceSlug === "string" && body.workspaceSlug.trim()) ||
    (typeof body.workspace === "string" && body.workspace.trim()) ||
    request.headers.get("x-workspace-id") ||
    request.headers.get("x-workspace-slug"),
  );
}

async function resolveOptionalWorkspaceId(
  admin: ReturnType<typeof getAdminClient>,
  request: NextRequest,
  body: ForgotPasswordBody,
): Promise<string | null> {
  if (!hasWorkspaceContext(request, body)) return null;
  try {
    return await resolveWorkspaceId(admin, request, body);
  } catch (err) {
    console.error("[forgot-password] workspace context ignored:", err instanceof Error ? err.message : err);
    return null;
  }
}

async function lookupWorkspaceMember(
  admin: ReturnType<typeof getAdminClient>,
  workspaceId: string,
  email: string,
): Promise<TeamMemberAccess | null> {
  const { data, error } = await admin
    .from("team_members")
    .select("name, role, status")
    .eq("workspace_id", workspaceId)
    .eq("email", email)
    .maybeSingle<TeamMemberAccess>();
  if (error) {
    console.error("[forgot-password] member lookup failed:", error.message);
    return null;
  }
  return data || null;
}

export async function POST(request: NextRequest) {
  try {
    // Rate limit: 5 requests per minute per IP. Fails open on infrastructure
    // errors so an outage in the rate limiter does not block legitimate users.
    const ip = getClientIp(request);
    const ipCheck = await consume("forgot-password:ip", ip, 5, 60, { onError: "deny" });
    if (!ipCheck.allowed) {
      console.warn(`[forgot-password] rate-limited IP ${ip}`);
      // Anti-enumeration: still return success so the attacker cannot
      // distinguish rate-limited from unknown-email.
      return NextResponse.json({ success: true });
    }

    const body = await request.json() as ForgotPasswordBody;
    const email = typeof body.email === "string" ? body.email : "";

    // ALWAYS return success to prevent email enumeration
    const successResponse = NextResponse.json({ success: true });

    if (!email?.trim()) return successResponse;

    const cleanEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return successResponse;

    const admin = getAdminClient();
    const workspaceContextProvided = hasWorkspaceContext(request, body);
    let requestedWorkspaceId: string | null = null;
    let requestedWorkspaceMember: TeamMemberAccess | null = null;
    if (workspaceContextProvided) {
      try {
        requestedWorkspaceId = await resolveWorkspaceId(admin, request, body);
      } catch (err) {
        console.error("[forgot-password] workspace context invalid:", err instanceof Error ? err.message : err);
        return successResponse;
      }
      requestedWorkspaceMember = await lookupWorkspaceMember(admin, requestedWorkspaceId, cleanEmail);
      if (!requestedWorkspaceMember) {
        return successResponse;
      }
    }

    // Generate recovery link (no email sent by Supabase)
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "recovery",
      email: cleanEmail,
    });

    if (linkErr || !linkData?.properties?.hashed_token) {
      const workspaceId = requestedWorkspaceId || await resolveWorkspaceId(admin, request, body);
      // New cloned deployments can have active team_members rows before their
      // matching Supabase Auth users exist. In that case, treat forgot password
      // as a self-service setup-link request for known team members only.
      const member = requestedWorkspaceMember || await lookupWorkspaceMember(admin, workspaceId, cleanEmail);

      const status = String(member?.status || "");
      const name = typeof member?.name === "string" && member.name.trim() ? member.name.trim() : cleanEmail.split("@")[0];
      const role = typeof member?.role === "string" ? member.role : "";
      if (!member || !role || !["active", "pending"].includes(status)) {
        // Don't reveal that the email doesn't exist.
        console.error("[forgot-password] recovery link unavailable:", linkErr?.message);
        return successResponse;
      }

      const tempPassword = crypto.randomUUID() + "!Aa1";
      const { data: authData, error: createErr } = await admin.auth.admin.createUser({
        email: cleanEmail,
        password: tempPassword,
        email_confirm: false,
        user_metadata: { name, role },
      });

      const createdUserId = authData?.user?.id || null;
      if (createErr) {
        // Keep going: a previous setup-email attempt may have created the Auth
        // user already, and Supabase can still generate a fresh invite link.
        console.error("[forgot-password] setup user creation failed:", createErr?.message);
      }

      const { data: inviteData, error: inviteErr } = await admin.auth.admin.generateLink({
        type: "invite",
        email: cleanEmail,
        options: { data: { name, role } },
      });

      if (inviteErr || !inviteData?.properties?.hashed_token) {
        console.error("[forgot-password] setup link generation failed:", inviteErr?.message);
        if (createdUserId) await admin.auth.admin.deleteUser(createdUserId);
        return successResponse;
      }

      const siteUrl = getSiteUrl();
      const tokenHash = inviteData.properties.hashed_token;
      const confirmUrl = `${siteUrl}/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=invite&workspaceId=${encodeURIComponent(workspaceId)}`;
      try {
        await sendSetupEmail(cleanEmail, name, role, confirmUrl);
      } catch (emailErr: unknown) {
        console.error("[forgot-password] Setup email send failed:", emailErr instanceof Error ? emailErr.message : emailErr);
      }
      return successResponse;
    }

    if (workspaceContextProvided && String(requestedWorkspaceMember?.status || "") !== "active") {
      return successResponse;
    }

    // Build our own confirmation URL
    const siteUrl = getSiteUrl();
    const tokenHash = linkData.properties.hashed_token;
    const recoveryWorkspaceId = requestedWorkspaceId || await resolveOptionalWorkspaceId(admin, request, body);
    const confirmParams = new URLSearchParams({
      token_hash: tokenHash,
      type: "recovery",
    });
    if (recoveryWorkspaceId) confirmParams.set("workspaceId", recoveryWorkspaceId);
    const confirmUrl = `${siteUrl}/auth/confirm?${confirmParams.toString()}`;

    // Send branded password reset email
    try {
      await sendRecoveryEmail(cleanEmail, confirmUrl);
    } catch (emailErr: unknown) {
      console.error("[forgot-password] Email send failed:", emailErr instanceof Error ? emailErr.message : emailErr);
    }

    return successResponse;
  } catch (err: unknown) {
    console.error("[forgot-password]", err instanceof Error ? err.message : err);
    // Always return success (anti-enumeration)
    return NextResponse.json({ success: true });
  }
}
