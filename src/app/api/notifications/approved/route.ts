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
import { requireBearerUser } from "@/lib/auth/require";

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
  postTitle: string;
  approvedBy: string;
  createdBy?: string;
}

export async function POST(request: NextRequest) {
  try {
    // SEC-012: Authenticate the caller. `approvedBy` is now derived from
    // the bearer-token user's team_members row — clients cannot forge the
    // approver name.
    const auth = await requireBearerUser(request);
    if (auth instanceof NextResponse) return auth;

    const ip = getClientIp(request);
    const ipCheck = await consume("notifications:approved:ip", ip, 10, 60);
    if (!ipCheck.allowed) {
      return NextResponse.json({ error: "Rate limited" }, { status: 429 });
    }

    const body: ApprovedRequest = await request.json();

    if (!body.postId || !body.postTitle) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    if (!body.createdBy) {
      return NextResponse.json({ sent: 0, reason: "No creator specified" });
    }

    const admin = getAdminClient();

    // SEC-012: Override `approvedBy` with the server-resolved team_members
    // name for the authenticated caller.
    // SEC-010: `.eq` — callerEmail is already lowercased; `.ilike` would let
    // wildcard chars in a crafted email act as SQL patterns.
    const callerEmail = (auth.user.email || "").toLowerCase();
    const { data: approverRow } = await admin
      .from("team_members")
      .select("name, email")
      .eq("email", callerEmail)
      .maybeSingle();
    const approvedBy = (approverRow?.name as string) || auth.user.email || "Approver";

    // Fetch full post data for rich email
    const { data: post } = await admin
      .from("posts")
      .select("platforms, content_type, scheduled_date, scheduled_time, caption")
      .eq("id", body.postId)
      .maybeSingle();

    // Look up creator email by name (same pattern as revision route)
    const { data: creator } = await admin
      .from("team_members")
      .select("email, name")
      .eq("name", body.createdBy)
      .maybeSingle();

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
        creatorName: creator.name || body.createdBy,
        approverName: approvedBy,
        postTitle: body.postTitle,
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
          subject: safeSubject(`Post Approved: "${body.postTitle}"`),
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
      p_metadata: { approvedBy, notified: creator.email, sent },
    });

    return NextResponse.json({ sent, recipient: creator.email });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[notifications/approved]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
