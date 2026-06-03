import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getTransporter, getFromAddress, getSiteUrl, buildApprovalEmailHtml } from "@/lib/email-utils";
import { requireBearerTeamRole } from "@/lib/auth/require";

export const maxDuration = 10;
const VALID_ROLES = new Set(["admin", "approver", "creative_director", "social_media_specialist", "video_editor", "graphic_designer"]);

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase admin credentials not configured");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

interface ApproveBody {
  requestId: string;
  action: "approve" | "reject";
  role?: string;
  // reviewedBy is derived from the Bearer token; client value is ignored.
  reviewedBy?: string;
}

export async function POST(request: NextRequest) {
  try {
    // ─── Auth: superadmin-only via verified Bearer token ───
    const ctx = await requireBearerTeamRole(request, ["superadmin"]);
    if (ctx instanceof NextResponse) return ctx;
    const reviewerEmail = ctx.email;

    const body: ApproveBody = await request.json();

    if (!body.requestId || !body.action) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const admin = getAdminClient();

    // Get the request
    const { data: req, error: fetchErr } = await admin
      .from("signup_requests")
      .select("*")
      .eq("id", body.requestId)
      .single();

    if (fetchErr || !req) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }

    if (req.status !== "pending") {
      return NextResponse.json({ error: "Request already processed" }, { status: 409 });
    }

    if (body.action === "reject") {
      const { error: rejectErr } = await admin
        .from("signup_requests")
        .update({ status: "rejected", reviewed_by: reviewerEmail, reviewed_at: new Date().toISOString() })
        .eq("id", body.requestId);
      if (rejectErr) {
        console.error("[approve-request] reject update failed:", rejectErr.message);
        return NextResponse.json({ error: "Failed to reject request" }, { status: 500 });
      }

      return NextResponse.json({ success: true, action: "rejected" });
    }

    // ─── Approve: createUser + generateLink + branded email ───
    const role = body.role || "social_media_specialist";
    if (!VALID_ROLES.has(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }
    const requestEmail = String(req.email || "").trim().toLowerCase();
    if (!/^[^\s@\r\n]+@[^\s@\r\n]+\.[^\s@\r\n]+$/.test(requestEmail)) {
      return NextResponse.json({ error: "Request email is invalid" }, { status: 409 });
    }

    const { data: existingMember, error: existingMemberErr } = await admin
      .from("team_members")
      .select("id")
      .eq("email", requestEmail)
      .maybeSingle();
    if (existingMemberErr) {
      console.error("[approve-request] existing member lookup failed:", existingMemberErr.message);
      return NextResponse.json({ error: "Could not verify existing team member" }, { status: 500 });
    }
    if (existingMember) {
      return NextResponse.json({ error: "That email is already a team member" }, { status: 409 });
    }

    // Clean up any orphaned auth user first
    let page = 1;
    const perPage = 100;
    while (true) {
      const { data: { users }, error: listErr } = await admin.auth.admin.listUsers({ page, perPage });
      if (listErr) {
        console.error("[approve-request] auth lookup failed:", listErr.message);
        return NextResponse.json({ error: "Could not verify previous auth account" }, { status: 500 });
      }
      if (!users || users.length === 0) break;
      const found = users.find((u) => u.email?.toLowerCase() === requestEmail);
      if (found) {
        const { error: workspaceCleanupErr } = await admin.from("workspace_members").delete().eq("user_id", found.id);
        if (workspaceCleanupErr) {
          console.error("[approve-request] workspace cleanup failed:", workspaceCleanupErr.message);
          return NextResponse.json({ error: "Failed to clean up previous workspace access" }, { status: 500 });
        }
        const { error: authCleanupErr } = await admin.auth.admin.deleteUser(found.id);
        if (authCleanupErr) {
          console.error("[approve-request] auth cleanup failed:", authCleanupErr.message);
          return NextResponse.json({ error: "Failed to clean up previous auth account" }, { status: 500 });
        }
        break;
      }
      if (users.length < perPage) break;
      page++;
    }

    // Step 1: Create user silently with random temp password
    const tempPassword = crypto.randomUUID() + "!Aa1";
    const { data: authData, error: createErr } = await admin.auth.admin.createUser({
      email: requestEmail,
      password: tempPassword,
      email_confirm: false,
      user_metadata: { name: req.name, role, phone: req.phone },
    });

    if (createErr) {
      console.error("[approve-request] createUser failed:", createErr.message);
      return NextResponse.json({ error: `Failed to create user: ${createErr.message}` }, { status: 500 });
    }

    // Step 2: Generate invite link
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "invite",
      email: requestEmail,
      options: { data: { name: req.name, role } },
    });

    if (linkErr || !linkData?.properties?.hashed_token) {
      console.error("[approve-request] generateLink failed:", linkErr?.message);
      if (authData?.user?.id) await admin.auth.admin.deleteUser(authData.user.id);
      return NextResponse.json({ error: "Failed to generate invite link" }, { status: 500 });
    }

    // Step 3: Build confirmation URL
    const siteUrl = getSiteUrl();
    const tokenHash = linkData.properties.hashed_token;
    const confirmUrl = `${siteUrl}/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=invite`;

    // Step 4: Insert into team_members BEFORE email
    const { data: member, error: memberErr } = await admin
      .from("team_members")
      .insert({
        name: req.name,
        email: requestEmail,
        phone: req.phone || null,
        role,
        status: "pending",
      })
      .select("id")
      .single();

    if (memberErr) {
      if (authData?.user?.id) await admin.auth.admin.deleteUser(authData.user.id);
      return NextResponse.json({ error: "Failed to create team member" }, { status: 500 });
    }

    // Update request status before sending email. If this fails, roll back the
    // newly-created invite state so the request can be approved cleanly later.
    const { error: requestUpdateErr } = await admin
      .from("signup_requests")
      .update({ status: "approved", reviewed_by: reviewerEmail, reviewed_at: new Date().toISOString() })
      .eq("id", body.requestId);
    if (requestUpdateErr) {
      console.error("[approve-request] request status update failed:", requestUpdateErr.message);
      if (member?.id) await admin.from("team_members").delete().eq("id", member.id);
      if (authData?.user?.id) {
        await admin.from("workspace_members").delete().eq("user_id", authData.user.id);
        await admin.auth.admin.deleteUser(authData.user.id);
      }
      return NextResponse.json({ error: "Failed to finalize access request approval" }, { status: 500 });
    }

    // Step 5: Send branded approval email (best-effort, don't block approval)
    let emailSent = false;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    if (smtpUser && smtpPass) {
      try {
        const transporter = getTransporter();
        await transporter.sendMail({
          from: getFromAddress(),
          to: requestEmail,
          subject: `Your access to The Reach has been approved!`,
          html: buildApprovalEmailHtml(req.name, role, confirmUrl),
        });
        emailSent = true;
      } catch (emailErr: unknown) {
        console.error("[approve-request] Email send failed:", emailErr instanceof Error ? emailErr.message : emailErr);
      }
    }

    // Audit log
    try {
      await admin.rpc("record_audit_event", {
        p_entity_type: "team",
        p_action: "request_approved",
        p_entity_id: null,
        p_workspace_id: ctx.workspaceId,
        p_metadata: {
          user_name: reviewerEmail,
          details: emailSent
            ? `Approved ${req.name} (${requestEmail}) as ${role} — email sent`
            : `Approved ${req.name} (${requestEmail}) as ${role} — email failed, invite link generated`,
        },
      });
    } catch { /* best-effort */ }

    return NextResponse.json({
      success: true,
      action: "approved",
      email: requestEmail,
      emailSent,
      inviteUrl: emailSent ? undefined : confirmUrl,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[approve-request]", message);
    return NextResponse.json({ error: message.slice(0, 200) }, { status: 500 });
  }
}
