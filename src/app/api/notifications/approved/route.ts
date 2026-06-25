import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  getTransporter,
  getFromAddress,
  getSiteUrl,
  safeSubject,
  buildPostApprovedEmailHtml,
} from "@/lib/email-utils";
import { APP_TIMEZONE } from "@/lib/utils";
import { consume, getClientIp } from "@/lib/rate-limit";
import { APPROVAL_NOTIFICATION_ROLES, loadCallerProfile, loadMemberByCreatorKey, loadWorkspacePost, requireNotificationContext } from "../_shared";

export const maxDuration = 10;

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase admin credentials not configured");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

const CONTENT_TYPE_LABELS: Record<string, string> = {
  video:    "Video",
  image:    "Image",
  carousel: "Carousel",
  reel:     "Reel",
  story:    "Story",
};

function formatScheduled(date?: string | null, time?: string | null): string | null {
  if (!date) return null;
  try {
    const d = new Date(`${date}T${time || "00:00"}`);
    const dateStr = d.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: APP_TIMEZONE,
    });
    const timeStr = time
      ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: APP_TIMEZONE }) + " CT"
      : null;
    return timeStr ? `${dateStr} at ${timeStr}` : dateStr;
  } catch {
    return date;
  }
}

interface ApprovedRequest {
  postId: string;
  postTitle?: string;
  approvedBy?: string;
  createdBy?: string;
}

export async function POST(request: NextRequest) {
  try {
    // SEC-012: Authenticate the caller. `approvedBy` is now derived from
    // the bearer-token user's team_members row — clients cannot forge the
    // approver name.
    const ctx = await requireNotificationContext(request, APPROVAL_NOTIFICATION_ROLES);
    if (ctx instanceof NextResponse) return ctx;

    const ip = getClientIp(request);
    const ipCheck = await consume("notifications:approved:ip", ip, 10, 60, { onError: "deny" });
    if (!ipCheck.allowed) {
      return NextResponse.json({ error: "Rate limited" }, { status: 429 });
    }

    const body: ApprovedRequest = await request.json();

    if (!body.postId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const admin = getAdminClient();

    // SEC-012: Override `approvedBy` with the server-resolved team_members
    // name for the authenticated caller.
    const caller = await loadCallerProfile(admin, ctx.email, ctx.workspaceId);
    const approvedBy = caller.name || "Approver";

    // Fetch full post data for rich email
    const post = await loadWorkspacePost<{
      id: string;
      title?: string | null;
      platforms?: string[] | null;
      content_type?: string | null;
      scheduled_date?: string | null;
      scheduled_time?: string | null;
      caption?: string | null;
      created_by?: string | null;
    }>(
      admin,
      body.postId,
      ctx.workspaceId,
      "id, title, platforms, content_type, scheduled_date, scheduled_time, caption, created_by",
    );
    if (post instanceof NextResponse) return post;
    const postTitle = post.title || "Post";

    // Look up creator email by name (same pattern as revision route)
    const creator = await loadMemberByCreatorKey(admin, post.created_by || body.createdBy, ctx.workspaceId);

    if (!creator?.email) {
      return NextResponse.json({ sent: 0, reason: "Creator not found in team_members" });
    }

    const platforms: string[] = (post?.platforms as string[]) || [];
    const contentType =
      CONTENT_TYPE_LABELS[(post?.content_type as string) || ""] ||
      (post?.content_type as string) ||
      "";
    const scheduled = formatScheduled(
      post?.scheduled_date as string,
      post?.scheduled_time as string,
    );
    const caption = (post?.caption as string | null) || null;
    const captionPreview = caption
      ? caption.slice(0, 220) + (caption.length > 220 ? "\u2026" : "")
      : null;
    const siteUrl = getSiteUrl();

    const smtpConfigured = process.env.SMTP_USER && process.env.SMTP_PASS;
    let sent = 0;

    if (smtpConfigured) {
      const transporter = getTransporter();
      const html = buildPostApprovedEmailHtml({
        creatorName: creator.name || body.createdBy || "Creator",
        approverName: approvedBy,
        postTitle,
        platforms,
        scheduled,
        contentType,
        captionPreview,
        siteUrl,
      });

      try {
        await transporter.sendMail({
          from: getFromAddress(),
          to: creator.email,
          subject: safeSubject(`Post Approved: "${postTitle}"`),
          html,
        });
        sent = 1;
      } catch (err) {
        console.error(`[approved] Failed to email ${creator.email}:`, err);
      }
    }

    await admin.rpc("record_audit_event", {
      p_entity_type: "post",
      p_action: "post_approved_notified",
      p_entity_id: body.postId,
      p_workspace_id: ctx.workspaceId,
      p_metadata: { approvedBy, notified_count: creator.email ? 1 : 0, sent },
    });

    return NextResponse.json({ sent, recipientCount: creator.email ? 1 : 0 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[notifications/approved]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
