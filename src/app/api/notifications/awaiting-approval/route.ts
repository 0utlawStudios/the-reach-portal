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

interface AwaitingApprovalRequest {
  postId: string;
  postTitle: string;
  movedBy: string;
  fromStage?: string;
}

export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    const ipCheck = await consume("notifications:awaiting-approval:ip", ip, 10, 60);
    if (!ipCheck.allowed) {
      return NextResponse.json({ error: "Rate limited" }, { status: 429 });
    }

    const body: AwaitingApprovalRequest = await request.json();
    if (!body.postId || !body.postTitle || !body.movedBy) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const admin = getAdminClient();
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://smm.ten80ten.com";

    // All roles with approval authority
    const { data: admins } = await admin
      .from("team_members")
      .select("email, role, name")
      .in("role", ["superadmin", "admin", "creative_director", "approver"]);

    const recipients: string[] = [];
    if (admins) {
      for (const a of admins) {
        if (a.email && !recipients.includes(a.email)) {
          recipients.push(a.email);
        }
      }
    }

    if (recipients.length === 0) {
      return NextResponse.json({ sent: 0, reason: "No admin recipients found" });
    }

    const fromLabel =
      body.fromStage === "revision_needed" ? "Revision Needed" : "Ideas";

    const smtpConfigured = process.env.SMTP_USER && process.env.SMTP_PASS;
    let sent = 0;

    if (smtpConfigured) {
      const transporter = getTransporter();

      const htmlEmail = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 540px; margin: 0 auto; background: #0a0a0e; border-radius: 16px; overflow: hidden;">
          <div style="padding: 32px 28px 24px; border-bottom: 1px solid rgba(255,255,255,0.06);">
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 20px;">
              <div style="width: 40px; height: 40px; border-radius: 10px; background: linear-gradient(135deg, #2563eb, #7c3aed); display: flex; align-items: center; justify-content: center;">
                <span style="color: white; font-size: 20px; font-weight: 800;">&#10003;</span>
              </div>
              <div>
                <p style="color: #60a5fa; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; margin: 0;">Ready for Review</p>
                <p style="color: #6b7280; font-size: 12px; margin: 2px 0 0;">submitted by ${esc(body.movedBy)}</p>
              </div>
            </div>
            <h2 style="color: #ffffff; font-size: 20px; font-weight: 700; margin: 0 0 16px; letter-spacing: -0.02em;">${esc(body.postTitle)}</h2>
            <div style="background: rgba(37,99,235,0.08); border-left: 3px solid #2563eb; padding: 14px 18px; border-radius: 0 10px 10px 0;">
              <p style="color: #93c5fd; font-size: 13px; line-height: 1.6; margin: 0;">
                Moved from <strong style="color: #bfdbfe;">${esc(fromLabel)}</strong> to <strong style="color: #bfdbfe;">Awaiting Approval</strong>. Your review is needed.
              </p>
            </div>
          </div>
          <div style="padding: 24px 28px;">
            <a href="${esc(siteUrl)}" style="display: inline-block; background: #2563eb; color: white; text-decoration: none; padding: 12px 28px; border-radius: 10px; font-size: 13px; font-weight: 700; letter-spacing: 0.01em;">
              Review in Portal
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
            subject: safeSubject(`Ready for Review: "${body.postTitle}"`),
            html: htmlEmail,
          });
          sent++;
        } catch (err) {
          console.error(`[awaiting-approval] Failed to email ${email}:`, err);
        }
      }
    }

    await admin.from("post_audit_logs").insert({
      post_id: body.postId,
      user_name: body.movedBy,
      action_type: "awaiting_approval_notified",
      details: `Notified admins: ${recipients.join(", ")}`,
    });

    return NextResponse.json({ sent, recipients });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[notifications/awaiting-approval]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
