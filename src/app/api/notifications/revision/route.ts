import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getTransporter, getFromAddress, safeSubject, buildRevisionEmailHtml } from "@/lib/email-utils";
import { consume, getClientIp } from "@/lib/rate-limit";
import { requireBearerUser } from "@/lib/auth/require";

export const maxDuration = 10;

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase admin credentials not configured");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}


interface RevisionRequest {
  postId: string;
  postTitle: string;
  revisionNote: string;
  requestedBy: string;
  createdBy?: string;
}

export async function POST(request: NextRequest) {
  try {
    // SEC-012: Authenticate the caller and derive `requestedBy` server-side.
    const auth = await requireBearerUser(request);
    if (auth instanceof NextResponse) return auth;

    // Rate limit: 10 per minute per IP.
    const ip = getClientIp(request);
    const ipCheck = await consume("notifications:revision:ip", ip, 10, 60);
    if (!ipCheck.allowed) {
      return NextResponse.json({ error: "Rate limited" }, { status: 429 });
    }

    const body: RevisionRequest = await request.json();
    if (!body.postId || !body.postTitle || !body.revisionNote) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const admin = getAdminClient();
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://smm.ten80ten.com";

    // SEC-012: Trust the authenticated caller's identity, not the body.
    const callerEmail = (auth.user.email || "").toLowerCase();
    const { data: callerRow } = await admin
      .from("team_members")
      .select("name, email")
      .ilike("email", callerEmail)
      .maybeSingle();
    const requestedBy = (callerRow?.name as string) || auth.user.email || "Reviewer";
    const requesterEmail = (callerRow?.email as string) || auth.user.email || "";

    const recipients: string[] = [];

    // Find the Creator's email
    if (body.createdBy) {
      const { data: creator } = await admin
        .from("team_members")
        .select("email")
        .eq("name", body.createdBy)
        .maybeSingle();
      if (creator?.email && creator.email !== requesterEmail) {
        recipients.push(creator.email);
      }
    }

    // Find all Creative Directors and Approvers
    const { data: directors } = await admin
      .from("team_members")
      .select("email, role")
      .in("role", ["creative_director", "approver"]);

    if (directors) {
      for (const d of directors) {
        if (d.email && !recipients.includes(d.email) && d.email !== requesterEmail) {
          recipients.push(d.email);
        }
      }
    }

    if (recipients.length === 0) {
      return NextResponse.json({ sent: 0, reason: "No recipients found" });
    }

    const smtpConfigured = process.env.SMTP_USER && process.env.SMTP_PASS;
    let sent = 0;

    if (smtpConfigured) {
      const transporter = getTransporter();

      const htmlEmail = buildRevisionEmailHtml(body.postTitle, body.revisionNote, requestedBy, siteUrl);

      for (const email of recipients) {
        try {
          await transporter.sendMail({
            from: getFromAddress(),
            to: email,
            subject: safeSubject(`Revision Requested: "${body.postTitle}"`),
            html: htmlEmail,
          });
          sent++;
        } catch (err) {
          console.error(`[revision] Failed to email ${email}:`, err);
        }
      }
    }

    // Log to audit
    await admin.rpc("record_audit_event", {
      p_entity_type: "post",
      p_action: "revision_requested",
      p_entity_id: body.postId,
      p_metadata: { user_name: requestedBy, details: `Notified: ${recipients.join(", ")}. Note: ${body.revisionNote.slice(0, 100)}` },
    });

    return NextResponse.json({ sent, recipients });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[notifications/revision]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
