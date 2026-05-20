import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getTransporter, getFromAddress, esc, safeSubject } from "@/lib/email-utils";
import { consume, getClientIp } from "@/lib/rate-limit";
import { requireBearerUser } from "@/lib/auth/require";

export const maxDuration = 10;

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase admin credentials not configured");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
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
    // SEC-012: Require an authenticated caller. The previous IP rate-limit
    // alone allowed any anonymous client to enumerate team_members via
    // crafted @mentions and to send emails on behalf of impersonated names.
    const auth = await requireBearerUser(request);
    if (auth instanceof NextResponse) return auth;

    // Rate limit: 10 per minute per IP.
    const ip = getClientIp(request);
    const ipCheck = await consume("notifications:mention:ip", ip, 10, 60);
    if (!ipCheck.allowed) {
      return NextResponse.json({ error: "Rate limited" }, { status: 429 });
    }

    const body: MentionRequest = await request.json();

    if (!body.comment || !body.postTitle) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const admin = getAdminClient();

    // SEC-012: Derive the author identity from the authenticated user's
    // team_members row. Anything sent in the body is ignored / overridden.
    // SEC-010: `.eq` — callerEmail is already lowercased; `.ilike` would let
    // wildcard chars in a crafted email act as SQL patterns.
    const callerEmail = (auth.user.email || "").toLowerCase();
    const { data: callerRow } = await admin
      .from("team_members")
      .select("name, email")
      .eq("email", callerEmail)
      .maybeSingle();
    const authorEmail = (callerRow?.email as string) || auth.user.email || "";
    const authorName = (callerRow?.name as string) || authorEmail || "Team member";

    const mentionedNames = extractMentions(body.comment);
    if (mentionedNames.length === 0) {
      return NextResponse.json({ sent: 0, mentions: [] });
    }

    // Look up mentioned users' emails from team_members
    const { data: members } = await admin
      .from("team_members")
      .select("name, email")
      .in("name", mentionedNames);

    if (!members || members.length === 0) {
      // SEC-012: Don't echo whether any name matched. Returning the matched
      // set turns this endpoint into a directory enumeration oracle.
      return NextResponse.json({ sent: 0 });
    }

    // Send email notifications
    const smtpConfigured = process.env.SMTP_USER && process.env.SMTP_PASS;
    let sent = 0;

    if (smtpConfigured) {
      const transporter = getTransporter();
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://smm.ten80ten.com";

      for (const member of members) {
        // Don't email yourself
        if (member.email === authorEmail) continue;

        try {
          await transporter.sendMail({
            from: getFromAddress(),
            to: member.email,
            subject: safeSubject(`${authorName} mentioned you in "${body.postTitle}"`),
            html: `
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 520px; margin: 0 auto;">
                <div style="background: linear-gradient(135deg, #ea580c, #dc2626); padding: 24px; border-radius: 12px 12px 0 0;">
                  <h2 style="color: white; margin: 0; font-size: 16px; font-weight: 600;">You were mentioned</h2>
                </div>
                <div style="background: #ffffff; padding: 24px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
                  <p style="color: #374151; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
                    <strong>${esc(authorName)}</strong> mentioned you in a comment on <strong>"${esc(body.postTitle)}"</strong>:
                  </p>
                  <div style="background: #f9fafb; border-left: 3px solid #ea580c; padding: 12px 16px; border-radius: 0 8px 8px 0; margin: 0 0 20px;">
                    <p style="color: #4b5563; font-size: 13px; line-height: 1.5; margin: 0; white-space: pre-wrap;">${esc(body.comment)}</p>
                  </div>
                  <a href="${esc(siteUrl)}" style="display: inline-block; background: #ea580c; color: white; text-decoration: none; padding: 10px 24px; border-radius: 8px; font-size: 13px; font-weight: 600;">
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
      await admin.rpc("record_audit_event", {
        p_entity_type: "post",
        p_action: "mention_sent",
        p_entity_id: body.postId,
        p_metadata: { user_name: authorName, details: `Mentioned ${members.length} member(s) in comment` },
      });
    }

    // SEC-012: `matched` removed — it was a directory enumeration oracle.
    // Return only the aggregate count of recipients we actually emailed.
    return NextResponse.json({
      sent,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[notifications/mention]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
