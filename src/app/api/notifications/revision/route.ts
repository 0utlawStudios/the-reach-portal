import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getTransporter, getFromAddress, esc, safeSubject } from "@/lib/email-utils";
import { consume, getClientIp } from "@/lib/rate-limit";

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
    // Rate limit: 10 per minute per IP.
    const ip = getClientIp(request);
    const ipCheck = await consume("notifications:revision:ip", ip, 10, 60);
    if (!ipCheck.allowed) {
      return NextResponse.json({ error: "Rate limited" }, { status: 429 });
    }

    const body: RevisionRequest = await request.json();
    if (!body.postId || !body.postTitle || !body.revisionNote || !body.requestedBy) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const admin = getAdminClient();
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://smm.ten80ten.com";
    const recipients: string[] = [];

    // Find the Creator's email
    if (body.createdBy) {
      const { data: creator } = await admin
        .from("team_members")
        .select("email")
        .eq("name", body.createdBy)
        .maybeSingle();
      if (creator?.email && creator.email !== body.requestedBy) {
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
        if (d.email && !recipients.includes(d.email) && d.email !== body.requestedBy) {
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

      const htmlEmail = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 540px; margin: 0 auto; background: #0a0a0e; border-radius: 16px; overflow: hidden;">
          <div style="padding: 32px 28px 24px; border-bottom: 1px solid rgba(255,255,255,0.06);">
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 20px;">
              <div style="width: 40px; height: 40px; border-radius: 10px; background: linear-gradient(135deg, #ea580c, #dc2626); display: flex; align-items: center; justify-content: center;">
                <span style="color: white; font-size: 18px; font-weight: 800;">!</span>
              </div>
              <div>
                <p style="color: #f97316; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; margin: 0;">Revision Requested</p>
                <p style="color: #6b7280; font-size: 12px; margin: 2px 0 0;">by ${esc(body.requestedBy)}</p>
              </div>
            </div>
            <h2 style="color: #ffffff; font-size: 20px; font-weight: 700; margin: 0 0 16px; letter-spacing: -0.02em;">${esc(body.postTitle)}</h2>
            <div style="background: rgba(249,115,22,0.08); border-left: 3px solid #ea580c; padding: 14px 18px; border-radius: 0 10px 10px 0;">
              <p style="color: #fdba74; font-size: 13px; line-height: 1.6; margin: 0; white-space: pre-wrap;">${esc(body.revisionNote)}</p>
            </div>
          </div>
          <div style="padding: 24px 28px;">
            <a href="${esc(siteUrl)}" style="display: inline-block; background: #ea580c; color: white; text-decoration: none; padding: 12px 28px; border-radius: 10px; font-size: 13px; font-weight: 700; letter-spacing: 0.01em;">
              View Revision in Portal
            </a>
            <p style="color: #374151; font-size: 11px; margin: 16px 0 0;">Ten80Ten Content Pipeline</p>
          </div>
        </div>
      `;

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
    await admin.from("post_audit_logs").insert({
      post_id: body.postId,
      user_name: body.requestedBy,
      action_type: "revision_requested",
      details: `Notified: ${recipients.join(", ")}. Note: ${body.revisionNote.slice(0, 100)}`,
    });

    return NextResponse.json({ sent, recipients });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[notifications/revision]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
