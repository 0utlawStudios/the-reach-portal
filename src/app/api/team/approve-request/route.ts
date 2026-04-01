import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getTransporter, getFromAddress, getSiteUrl, buildApprovalEmailHtml } from "@/lib/email-utils";

export const maxDuration = 10;

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
  reviewedBy: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: ApproveBody = await request.json();

    if (!body.requestId || !body.action || !body.reviewedBy) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const admin = getAdminClient();

    // ─── RBAC: Only superadmin can approve/reject ───
    const { data: reviewer } = await admin
      .from("team_members")
      .select("role")
      .eq("email", body.reviewedBy)
      .single();

    if (!reviewer || reviewer.role !== "superadmin") {
      return NextResponse.json({ error: "Only superadmins can approve or reject requests" }, { status: 403 });
    }

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
      await admin
        .from("signup_requests")
        .update({ status: "rejected", reviewed_by: body.reviewedBy, reviewed_at: new Date().toISOString() })
        .eq("id", body.requestId);

      return NextResponse.json({ success: true, action: "rejected" });
    }

    // ─── Approve: createUser + generateLink + branded email ───
    const role = body.role || "social_media_specialist";

    // Clean up any orphaned auth user first
    let page = 1;
    const perPage = 100;
    while (true) {
      const { data: { users }, error: listErr } = await admin.auth.admin.listUsers({ page, perPage });
      if (listErr || !users || users.length === 0) break;
      const found = users.find((u) => u.email?.toLowerCase() === req.email.toLowerCase());
      if (found) { await admin.auth.admin.deleteUser(found.id); break; }
      if (users.length < perPage) break;
      page++;
    }

    // Step 1: Create user silently with random temp password
    const tempPassword = crypto.randomUUID() + "!Aa1";
    const { data: authData, error: createErr } = await admin.auth.admin.createUser({
      email: req.email,
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
      email: req.email,
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
    const confirmUrl = `${siteUrl}/auth/confirm?token_hash=${tokenHash}&type=invite`;

    // Step 4: Insert into team_members BEFORE email
    const { error: memberErr } = await admin
      .from("team_members")
      .insert({
        name: req.name,
        email: req.email,
        phone: req.phone || null,
        role,
        status: "pending",
      });

    if (memberErr) {
      if (authData?.user?.id) await admin.auth.admin.deleteUser(authData.user.id);
      return NextResponse.json({ error: "Failed to create team member" }, { status: 500 });
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
          to: req.email,
          subject: `Your access to Ten80Ten has been approved!`,
          html: buildApprovalEmailHtml(req.name, role, confirmUrl),
        });
        emailSent = true;
      } catch (emailErr: any) {
        console.error("[approve-request] Email send failed:", emailErr?.message);
      }
    }

    // Update request status
    await admin
      .from("signup_requests")
      .update({ status: "approved", reviewed_by: body.reviewedBy, reviewed_at: new Date().toISOString() })
      .eq("id", body.requestId);

    // Audit log
    try {
      await admin.from("post_audit_logs").insert({
        user_name: body.reviewedBy,
        action_type: "request_approved",
        details: emailSent
          ? `Approved ${req.name} (${req.email}) as ${role} — email sent`
          : `Approved ${req.name} (${req.email}) as ${role} — email failed, invite link generated`,
      });
    } catch { /* best-effort */ }

    return NextResponse.json({
      success: true,
      action: "approved",
      email: req.email,
      emailSent,
      inviteUrl: emailSent ? undefined : confirmUrl,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[approve-request]", message);
    return NextResponse.json({ error: message.slice(0, 200) }, { status: 500 });
  }
}
