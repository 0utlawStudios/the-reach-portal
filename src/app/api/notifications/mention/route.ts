import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

export const maxDuration = 10;

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase admin credentials not configured");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function getTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT || 465),
    secure: true,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

// Extract @mentions from comment text — matches "@First Last" patterns
function extractMentions(text: string): string[] {
  const matches = text.matchAll(/@([A-Za-z][A-Za-z\s]*?)(?=\s@|\s*$|[.,!?;:\n])/g);
  return [...matches].map((m) => m[1].trim()).filter((n) => n.length > 1);
}

interface MentionRequest {
  comment: string;
  postTitle: string;
  postId: string;
  authorName: string;
  authorEmail: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: MentionRequest = await request.json();

    if (!body.comment || !body.postTitle || !body.authorName) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const mentionedNames = extractMentions(body.comment);
    if (mentionedNames.length === 0) {
      return NextResponse.json({ sent: 0, mentions: [] });
    }

    // Look up mentioned users' emails from team_members
    const admin = getAdminClient();
    const { data: members } = await admin
      .from("team_members")
      .select("name, email")
      .in("name", mentionedNames);

    if (!members || members.length === 0) {
      return NextResponse.json({ sent: 0, mentions: mentionedNames, matched: [] });
    }

    // Send email notifications
    const smtpConfigured = process.env.SMTP_USER && process.env.SMTP_PASS;
    let sent = 0;

    if (smtpConfigured) {
      const transporter = getTransporter();
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://ten80tensmm.vercel.app";

      for (const member of members) {
        // Don't email yourself
        if (member.email === body.authorEmail) continue;

        try {
          await transporter.sendMail({
            from: `"Ten80Ten Portal" <${process.env.SMTP_USER}>`,
            to: member.email,
            subject: `${body.authorName} mentioned you in "${body.postTitle}"`,
            html: `
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 520px; margin: 0 auto;">
                <div style="background: linear-gradient(135deg, #ea580c, #dc2626); padding: 24px; border-radius: 12px 12px 0 0;">
                  <h2 style="color: white; margin: 0; font-size: 16px; font-weight: 600;">You were mentioned</h2>
                </div>
                <div style="background: #ffffff; padding: 24px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
                  <p style="color: #374151; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
                    <strong>${body.authorName}</strong> mentioned you in a comment on <strong>"${body.postTitle}"</strong>:
                  </p>
                  <div style="background: #f9fafb; border-left: 3px solid #ea580c; padding: 12px 16px; border-radius: 0 8px 8px 0; margin: 0 0 20px;">
                    <p style="color: #4b5563; font-size: 13px; line-height: 1.5; margin: 0; white-space: pre-wrap;">${body.comment}</p>
                  </div>
                  <a href="${siteUrl}" style="display: inline-block; background: #ea580c; color: white; text-decoration: none; padding: 10px 24px; border-radius: 8px; font-size: 13px; font-weight: 600;">
                    Open Portal
                  </a>
                  <p style="color: #9ca3af; font-size: 11px; margin: 16px 0 0;">Ten80Ten Social Media Management Portal</p>
                </div>
              </div>
            `,
          });
          sent++;
        } catch (emailErr) {
          console.error(`[mention] Failed to email ${member.email}:`, emailErr);
        }
      }
    }

    // Log to audit
    if (body.postId) {
      await admin.from("post_audit_logs").insert({
        post_id: body.postId,
        user_name: body.authorName,
        action_type: "mention_sent",
        details: `Mentioned ${members.map((m) => m.name).join(", ")} in comment`,
      });
    }

    return NextResponse.json({
      sent,
      mentions: mentionedNames,
      matched: members.map((m) => m.name),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[notifications/mention]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
