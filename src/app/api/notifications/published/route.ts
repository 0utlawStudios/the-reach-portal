import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  buildPostPublishedAdminEmailHtml,
  getFromAddress,
  getSiteUrl,
  getTransporter,
  safeRecipients,
  safeSubject,
} from "@/lib/email-utils";
import { APP_TIMEZONE, isValidUuid } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 15;

const NOTIFY_ROLES = ["superadmin", "admin", "owner", "creative_director"];
const EXECUTOR = "Aldr1dge Hypervisor System - Agent 052";

type PlatformResult = {
  platform?: string | null;
  state?: string | null;
  postUrl?: string | null;
  error?: string | null;
};

type NormalizedPlatformResult = {
  platform: string;
  state: string;
  postUrl: string | null;
  error: string | null;
};

type PublishedRequest = {
  postId?: string;
  jobId?: string;
  jobState?: string;
  publishedCount?: number;
  failedCount?: number;
  platforms?: PlatformResult[];
  audit?: {
    platforms?: PlatformResult[];
    timestamp?: string;
  };
};

type PostRow = {
  id: string;
  workspace_id: string;
  title: string | null;
  stage: string | null;
  platforms: string[] | null;
  content_type: string | null;
  caption: string | null;
  posted_at: string | null;
  posted_urls: Record<string, string | null> | null;
};

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase admin credentials not configured");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function authorize(request: NextRequest): boolean {
  const expected = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!expected) return false;
  const auth = request.headers.get("authorization") || "";
  const bearer = auth.replace(/^Bearer\s+/i, "").trim();
  const headerSecret = request.headers.get("x-publisher-secret") || "";
  return bearer === expected || headerSecret === expected;
}

function normalizePlatforms(body: PublishedRequest, post: PostRow): NormalizedPlatformResult[] {
  const raw = body.platforms?.length ? body.platforms : body.audit?.platforms || [];
  const postedUrls = post.posted_urls || {};
  const fromPayload = raw
    .filter((p) => p.platform)
    .map((p) => ({
      platform: String(p.platform),
      state: String(p.state || (p.postUrl ? "succeeded" : "unknown")),
      postUrl: p.postUrl || postedUrls[String(p.platform)] || null,
      error: p.error || null,
    }));

  const seen = new Set(fromPayload.map((p) => p.platform));
  for (const [platform, url] of Object.entries(postedUrls)) {
    if (seen.has(platform)) continue;
    fromPayload.push({
      platform,
      state: url ? "succeeded" : "unknown",
      postUrl: url || null,
      error: null,
    });
  }
  return fromPayload;
}

function formatPublishedAt(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("en-US", {
    timeZone: APP_TIMEZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }) + " CT";
}

function telegramEscape(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function sendTelegram(params: {
  postTitle: string;
  jobState: string;
  platforms: NormalizedPlatformResult[];
  published: boolean;
}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatIds = (process.env.TELEGRAM_ADMIN_CHAT_ID || "")
    .split(/[,;\n]/)
    .map((v) => v.trim())
    .filter(Boolean);

  if (!token || chatIds.length === 0) return { sent: 0, skipped: "Telegram env missing" };

  const liveLines = params.platforms
    .filter((p) => p.state === "succeeded")
    .map((p) => {
      const label = telegramEscape(p.platform);
      return p.postUrl
        ? `- ${label}: ${telegramEscape(p.postUrl)}`
        : `- ${label}: published`;
    });
  const failedLines = params.platforms
    .filter((p) => p.state === "failed")
    .map((p) => `- ${telegramEscape(p.platform)}: ${telegramEscape(p.error || "failed")}`);

  const message = [
    params.published ? "<b>The Reach post published</b>" : "<b>The Reach publisher status</b>",
    `Post: ${telegramEscape(params.postTitle)}`,
    `State: ${telegramEscape(params.jobState)}`,
    liveLines.length ? `Live:\n${liveLines.join("\n")}` : "",
    failedLines.length ? `Needs attention:\n${failedLines.join("\n")}` : "",
    `Executed by ${EXECUTOR}`,
  ].filter(Boolean).join("\n\n");

  let sent = 0;
  for (const chatId of chatIds) {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "HTML",
        disable_web_page_preview: false,
      }),
    });
    if (res.ok) sent += 1;
    else console.error("[notifications/published] Telegram failed:", await res.text());
  }
  return { sent };
}

export async function POST(request: NextRequest) {
  try {
    if (!authorize(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json() as PublishedRequest;
    const postId = String(body.postId || "").trim();
    if (!isValidUuid(postId)) {
      return NextResponse.json({ error: "Invalid post id" }, { status: 400 });
    }

    const admin = getAdminClient();
    const { data: post, error: postError } = await admin
      .from("posts")
      .select("id, workspace_id, title, stage, platforms, content_type, caption, posted_at, posted_urls")
      .eq("id", postId)
      .maybeSingle();

    if (postError) {
      console.error("[notifications/published] post lookup failed:", postError.message);
      return NextResponse.json({ error: "Could not load post" }, { status: 500 });
    }
    if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });

    const postRow = post as PostRow;
    const platforms = normalizePlatforms(body, postRow);
    const postTitle = postRow.title || "Published post";
    const published = platforms.some((p) => p.state === "succeeded") || Number(body.publishedCount || 0) > 0;
    const jobState = body.jobState || (published ? "succeeded" : "unknown");

    const telegram = await sendTelegram({ postTitle, jobState, platforms, published });

    let emailSent = 0;
    let recipients: string[] = [];
    if (published && process.env.SMTP_USER && process.env.SMTP_PASS) {
      const { data: members, error: membersError } = await admin
        .from("team_members")
        .select("email, role, status")
        .in("role", NOTIFY_ROLES)
        .eq("status", "active");

      if (membersError) {
        console.error("[notifications/published] recipient lookup failed:", membersError.message);
      }

      recipients = safeRecipients((members || []).map((member) => member.email));
      if (recipients.length > 0) {
        const caption = postRow.caption || "";
        const html = buildPostPublishedAdminEmailHtml({
          postTitle,
          jobState,
          platforms,
          contentType: postRow.content_type,
          captionPreview: caption ? caption.slice(0, 260) + (caption.length > 260 ? "\u2026" : "") : null,
          publishedAt: formatPublishedAt(postRow.posted_at || body.audit?.timestamp || null),
          postUrl: getSiteUrl(),
        });
        const transporter = getTransporter();
        await transporter.sendMail({
          from: getFromAddress(),
          to: recipients,
          subject: safeSubject(`Published: "${postTitle}"`),
          html,
        });
        emailSent = recipients.length;
      }
    }

    await admin.rpc("record_audit_event", {
      p_entity_type: "post",
      p_action: published ? "auto_publish_admin_notified" : "auto_publish_status_alerted",
      p_entity_id: postId,
      p_workspace_id: postRow.workspace_id,
      p_metadata: {
        user_name: EXECUTOR,
        job_id: body.jobId || null,
        job_state: jobState,
        email_recipients: recipients,
        email_sent: emailSent,
        telegram_sent: telegram.sent || 0,
      },
    });

    return NextResponse.json({
      ok: true,
      published,
      emailSent,
      recipients,
      telegramSent: telegram.sent || 0,
      telegramSkipped: telegram.skipped || null,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[notifications/published]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
