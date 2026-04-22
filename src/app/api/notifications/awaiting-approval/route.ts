import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getTransporter, getFromAddress, esc, safeSubject } from "@/lib/email-utils";
import { APP_TIMEZONE } from "@/lib/utils";
import { consume, getClientIp } from "@/lib/rate-limit";

export const maxDuration = 10;

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase admin credentials not configured");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://smm.ten80ten.com";
const LOGO_URL = `${SITE_URL}/ten80ten-logo.png`;

const PLATFORM_META: Record<string, { label: string; color: string }> = {
  facebook:  { label: "Facebook",  color: "#1877f2" },
  instagram: { label: "Instagram", color: "#e1306c" },
  linkedin:  { label: "LinkedIn",  color: "#0a66c2" },
  youtube:   { label: "YouTube",   color: "#ff0000" },
  tiktok:    { label: "TikTok",    color: "#010101" },
};

const CONTENT_TYPE_LABELS: Record<string, string> = {
  video:    "Video",
  image:    "Image",
  carousel: "Carousel",
  reel:     "Reel",
  story:    "Story",
};

function platformBadgesHtml(platforms: string[]): string {
  if (!platforms?.length) return '<span style="color:#9ca3af;font-size:13px;">No platforms set</span>';
  return platforms.map((p) => {
    const m = PLATFORM_META[p] || { label: p, color: "#6b7280" };
    return `<span style="display:inline-block;background:${m.color};color:#fff;font-size:11px;font-weight:700;padding:4px 14px;border-radius:100px;margin:0 6px 6px 0;letter-spacing:0.02em;">${esc(m.label)}</span>`;
  }).join("");
}

function formatScheduled(date?: string | null, time?: string | null): string | null {
  if (!date) return null;
  try {
    const d = new Date(`${date}T${time || "00:00"}`);
    const dateStr = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: APP_TIMEZONE });
    const timeStr = time ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: APP_TIMEZONE }) + " CT" : null;
    return timeStr ? `${dateStr} at ${timeStr}` : dateStr;
  } catch { return date; }
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

    // Fetch full post data for rich email
    const { data: post } = await admin
      .from("posts")
      .select("title, platforms, content_type, scheduled_date, scheduled_time, caption")
      .eq("id", body.postId)
      .maybeSingle();

    const platforms: string[] = (post?.platforms as string[]) || [];
    const contentType = CONTENT_TYPE_LABELS[(post?.content_type as string) || ""] || (post?.content_type as string) || "";
    const scheduled = formatScheduled(post?.scheduled_date as string, post?.scheduled_time as string);
    const caption = (post?.caption as string | null) || null;
    const captionPreview = caption ? caption.slice(0, 220) + (caption.length > 220 ? "…" : "") : null;
    const fromLabel = body.fromStage === "revision_needed" ? "Revision Needed" : "Ideas";

    const { data: admins } = await admin
      .from("team_members")
      .select("email")
      .in("role", ["superadmin", "admin", "owner", "creative_director", "approver"]);

    const recipients: string[] = [];
    if (admins) {
      for (const a of admins) {
        if (a.email && !recipients.includes(a.email)) recipients.push(a.email);
      }
    }

    if (recipients.length === 0) {
      return NextResponse.json({ sent: 0, reason: "No admin recipients found" });
    }

    const smtpConfigured = process.env.SMTP_USER && process.env.SMTP_PASS;
    let sent = 0;

    if (smtpConfigured) {
      const transporter = getTransporter();

      const metaRow = (contentType || scheduled)
        ? `<div style="background:#f9fafb;border-radius:8px;padding:16px 20px;margin-bottom:${captionPreview ? "20px" : "0"};">
             <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
               <tr>
                 ${contentType ? `<td style="padding-right:40px;vertical-align:top;">
                   <p style="color:#9ca3af;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;margin:0 0 4px;">Content Type</p>
                   <p style="color:#111827;font-size:14px;font-weight:700;margin:0;">${esc(contentType)}</p>
                 </td>` : ""}
                 ${scheduled ? `<td style="vertical-align:top;">
                   <p style="color:#9ca3af;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;margin:0 0 4px;">Scheduled</p>
                   <p style="color:#111827;font-size:14px;font-weight:700;margin:0;">${esc(scheduled)}</p>
                 </td>` : ""}
               </tr>
             </table>
           </div>`
        : "";

      const captionBlock = captionPreview
        ? `<div style="border-left:3px solid #ea580c;padding:12px 16px;background:#fff7ed;border-radius:0 8px 8px 0;margin-bottom:4px;">
             <p style="color:#9ca3af;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;margin:0 0 6px;">Caption</p>
             <p style="color:#374151;font-size:13px;line-height:1.65;margin:0;white-space:pre-wrap;">${esc(captionPreview)}</p>
           </div>`
        : "";

      const htmlEmail = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:32px 16px;background:#f3f4f6;-webkit-font-smoothing:antialiased;">
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;max-width:580px;margin:0 auto;">

  <div style="background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.06),0 6px 24px rgba(0,0,0,0.08);">

    <!-- Top accent bar -->
    <div style="height:4px;background:linear-gradient(90deg,#f97316,#ea580c,#c2410c);"></div>

    <!-- Header -->
    <div style="padding:20px 32px;border-bottom:1px solid #f3f4f6;">
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <tr>
          <td style="vertical-align:middle;">
            <img src="${LOGO_URL}" alt="Ten80Ten" height="26" style="display:block;height:26px;width:auto;" />
          </td>
          <td style="text-align:right;vertical-align:middle;">
            <span style="background:#ea580c;color:#ffffff;font-size:9px;font-weight:800;padding:5px 14px;border-radius:100px;letter-spacing:0.12em;text-transform:uppercase;">Action Required</span>
          </td>
        </tr>
      </table>
    </div>

    <!-- Body -->
    <div style="padding:28px 32px 24px;">

      <p style="color:#9ca3af;font-size:12px;font-weight:500;margin:0 0 10px;letter-spacing:0.01em;">
        Submitted by <strong style="color:#6b7280;">${esc(body.movedBy)}</strong>
        &nbsp;&middot;&nbsp;
        moved from <strong style="color:#6b7280;">${esc(fromLabel)}</strong>
      </p>

      <h1 style="color:#111827;font-size:22px;font-weight:800;margin:0 0 22px;line-height:1.25;letter-spacing:-0.02em;">${esc(body.postTitle)}</h1>

      <div style="margin-bottom:22px;">
        <p style="color:#9ca3af;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;margin:0 0 10px;">Posting to</p>
        <div>${platformBadgesHtml(platforms)}</div>
      </div>

      ${metaRow}
      ${captionBlock}

    </div>

    <!-- CTA -->
    <div style="padding:0 32px 28px;">
      <a href="${esc(SITE_URL)}"
         style="display:inline-block;background:linear-gradient(135deg,#ea580c 0%,#c2410c 100%);color:#ffffff;text-decoration:none;padding:14px 30px;border-radius:8px;font-size:14px;font-weight:700;letter-spacing:0.01em;">
        Open in Content Engine &rarr;
      </a>
      <p style="color:#9ca3af;font-size:12px;margin:14px 0 0;">Review, leave feedback, or approve this post for publishing.</p>
    </div>

    <!-- Footer -->
    <div style="padding:14px 32px;background:#f9fafb;border-top:1px solid #f3f4f6;">
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <tr>
          <td style="vertical-align:middle;">
            <img src="${LOGO_URL}" alt="Ten80Ten" height="14" style="display:block;height:14px;width:auto;opacity:0.5;" />
          </td>
          <td style="text-align:right;vertical-align:middle;">
            <span style="color:#9ca3af;font-size:11px;">Ten80Ten Content Engine</span>
          </td>
        </tr>
      </table>
    </div>

  </div>

</div>
</body>
</html>`;

      for (const email of recipients) {
        try {
          await transporter.sendMail({
            from: getFromAddress(),
            to: email,
            subject: safeSubject(`Action Required: "${body.postTitle}" is awaiting your review`),
            html: htmlEmail,
          });
          sent++;
        } catch (err) {
          console.error(`[awaiting-approval] Failed to email ${email}:`, err);
        }
      }
    }

    await admin.rpc("record_audit_event", {
      p_entity_type: "post",
      p_action: "awaiting_approval_notified",
      p_entity_id: body.postId,
      p_metadata: { movedBy: body.movedBy, notified: recipients },
    });

    return NextResponse.json({ sent, recipients });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[notifications/awaiting-approval]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
