import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getTransporter, getFromAddress, buildAdminNotificationHtml } from "@/lib/email-utils";
import { consume, getClientIp } from "@/lib/rate-limit";

export const maxDuration = 10;

const WORKSPACE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GENERIC_RECEIVED_RESPONSE = {
  success: true,
  status: "received",
  message: "If this email can request access, an admin will review it.",
};

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase admin credentials not configured");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

interface RequestBody {
  name: string;
  email: string;
  phone?: string | null;
  company?: string | null;
  reason?: string | null;
  workspaceId?: string | null;
  workspaceSlug?: string | null;
  workspace?: string | null;
}

async function resolveWorkspaceId(
  admin: ReturnType<typeof getAdminClient>,
  request: NextRequest,
  body: RequestBody,
): Promise<string> {
  const explicitId = (body.workspaceId || request.headers.get("x-workspace-id") || "").trim();
  const slugOrAlias = (body.workspaceSlug || body.workspace || request.headers.get("x-workspace-slug") || "").trim();
  const workspaceId = explicitId || (WORKSPACE_ID_RE.test(slugOrAlias) ? slugOrAlias : "");
  const workspaceSlug = workspaceId ? "" : slugOrAlias;
  if (!workspaceId && !workspaceSlug) {
    throw new Error("Workspace context required");
  }
  if (workspaceId && !WORKSPACE_ID_RE.test(workspaceId)) {
    throw new Error("Invalid workspace");
  }

  const query = admin
    .from("workspaces")
    .select("id")
    .limit(1);
  const { data, error } = workspaceId
    ? await query.eq("id", workspaceId).maybeSingle<{ id: string }>()
    : await query.eq("slug", workspaceSlug).maybeSingle<{ id: string }>();
  if (error) throw new Error("Could not verify workspace");
  if (!data?.id) throw new Error("Workspace not found");
  return data.id;
}

export async function POST(request: NextRequest) {
  try {
    // Rate limit: 5 per minute per IP. Anti-spam for the public signup form.
    const ip = getClientIp(request);
    const ipCheck = await consume("request-access:ip", ip, 5, 60, { onError: "deny" });
    if (!ipCheck.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429 },
      );
    }

    const body: RequestBody = await request.json();

    if (!body.name?.trim() || !body.email?.trim()) {
      return NextResponse.json({ error: "Name and email are required" }, { status: 400 });
    }

    const email = body.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
    }

    const admin = getAdminClient();
    const workspaceId = await resolveWorkspaceId(admin, request, body);

    const { data: existingMember, error: existingErr } = await admin
      .from("team_members")
      .select("id, status")
      .eq("workspace_id", workspaceId)
      .eq("email", email)
      .maybeSingle();
    if (existingErr) {
      console.error("[request-access] Team lookup failed:", existingErr.message);
      return NextResponse.json({ error: "Could not check access status. Please try again." }, { status: 500 });
    }

    const isPendingInviteRequest = existingMember?.status === "pending";
    if (existingMember && !isPendingInviteRequest) {
      return NextResponse.json(GENERIC_RECEIVED_RESPONSE);
    }

    const { data: pendingReq, error: pendingErr } = await admin
      .from("signup_requests")
      .select("id")
      .eq("email", email)
      .eq("workspace_id", workspaceId)
      .eq("status", "pending")
      .maybeSingle();
    if (pendingErr) {
      console.error("[request-access] Pending lookup failed:", pendingErr.message);
      return NextResponse.json({ error: "Could not check existing requests. Please try again." }, { status: 500 });
    }

    if (pendingReq) {
      return NextResponse.json(GENERIC_RECEIVED_RESPONSE);
    }

    const requestRow = {
      workspace_id: workspaceId,
      name: body.name.trim(),
      email,
      phone: body.phone || null,
      company: body.company || null,
      reason: body.reason || (isPendingInviteRequest ? "Already has a pending invite and requested access again." : null),
      status: "pending",
      requested_by: email,
    };

    const { data: inserted, error: insertErr } = await admin
      .from("signup_requests")
      .insert(requestRow)
      .select("id")
      .single();

    if (insertErr || !inserted?.id) {
      if ((insertErr as { code?: string } | null)?.code === "23505") {
        return NextResponse.json(GENERIC_RECEIVED_RESPONSE);
      }
      console.error("[request-access] Insert failed:", insertErr?.message || "missing inserted id");
      return NextResponse.json(
        { error: "Your request could not be saved. Please try again or ask the admin to invite you directly." },
        { status: 500 },
      );
    }

    // ─── Email admins about the new request (only for genuinely new emails) ───
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    let emailSent = false;
    let emailError = "";
    if (smtpUser && smtpPass) {
      try {
        const transporter = getTransporter();

        // Find superadmins and admins to notify
        const { data: admins, error: adminsErr } = await admin
          .from("team_members")
          .select("email")
          .eq("workspace_id", workspaceId)
          .in("role", ["superadmin", "admin"]);
        if (adminsErr) throw new Error(`Admin lookup failed: ${adminsErr.message}`);

        const adminEmails = admins?.map((a) => a.email).filter(Boolean) || [];

        if (adminEmails.length > 0) {
          await transporter.sendMail({
            from: getFromAddress(),
            to: adminEmails.join(", "),
            subject: `New Access Request: ${body.name.trim()}`,
            html: buildAdminNotificationHtml({
              name: body.name.trim(),
              email,
              phone: body.phone,
              company: body.company,
              reason: body.reason,
            }),
          });
          emailSent = true;
        }
      } catch (emailErr: unknown) {
        emailError = emailErr instanceof Error ? emailErr.message : "Unknown SMTP error";
        console.error("[request-access] Email FAILED:", emailError);
      }
    }

    try {
      await admin.rpc("record_audit_event", {
        p_entity_type: "team",
        p_action: "access_request_submitted",
        p_entity_id: inserted.id,
        p_workspace_id: workspaceId,
        p_metadata: {
          user_name: email,
          details: emailSent
            ? `Access request from ${body.name.trim()} (${email}) — admin email sent`
            : `Access request from ${body.name.trim()} (${email}) — saved, admin email not sent${emailError ? `: ${emailError}` : ""}`,
        },
      });
    } catch { /* best-effort */ }

    return NextResponse.json(GENERIC_RECEIVED_RESPONSE);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[request-access]", message);
    const status = /workspace/i.test(message) ? 400 : 500;
    return NextResponse.json(
      {
        error: status === 400
          ? "We could not submit this request for that workspace."
          : "Your request could not be submitted. Please try again.",
      },
      { status },
    );
  }
}
