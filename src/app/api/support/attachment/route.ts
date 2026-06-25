import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "@/lib/auth/require";
import { STREAM_INACTIVITY_TIMEOUT_MS, streamWithInactivityTimeout } from "@/lib/stream-inactivity-timeout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BUCKET = "support-attachments";
const STORAGE_RESPONSE_TIMEOUT_MS = 45_000;
const WORKSPACE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function adminClient() {
  return createClient(assertEnv("NEXT_PUBLIC_SUPABASE_URL"), assertEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function parseAttachmentStorageKey(value: string | null): { key: string; workspaceId: string; ownerUserId: string } | null {
  const key = (value || "").trim();
  if (
    !key ||
    key.length > 700 ||
    key.startsWith("/") ||
    key.includes("\\") ||
    key.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    return null;
  }
  const workspaceId = key.split("/")[0] || "";
  const ownerUserId = key.split("/")[1] || "";
  if (!WORKSPACE_ID_RE.test(workspaceId)) return null;
  if (!ownerUserId) return null;
  return { key, workspaceId, ownerUserId };
}

function storageObjectUrl(key: string): string {
  const base = assertEnv("NEXT_PUBLIC_SUPABASE_URL").replace(/\/+$/, "");
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  return `${base}/storage/v1/object/${BUCKET}/${encodedKey}`;
}

function copyHeader(source: Headers, target: Headers, name: string) {
  const value = source.get(name);
  if (value) target.set(name, value);
}

async function userSupportAttachmentAccess(userId: string, email: string | undefined, workspaceId: string, ownerUserId: string, storageKey: string): Promise<boolean> {
  const admin = adminClient();
  const { data, error } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userId)
    .eq("workspace_id", workspaceId)
    .eq("status", "active")
    .maybeSingle();
  if (error || !data) return false;
  const lowerEmail = (email || "").toLowerCase();
  if (!lowerEmail) return false;
  const { data: teamMember, error: teamError } = await admin
    .from("team_members")
    .select("role, status")
    .eq("workspace_id", workspaceId)
    .eq("email", lowerEmail)
    .maybeSingle();
  if (teamError || teamMember?.status !== "active") return false;
  if (userId === ownerUserId) return true;
  if (String(teamMember?.role || "").toLowerCase() === "superadmin") return true;

  // Non-admin users may view attachments sent by the team only when that exact
  // storage key is attached to one of their readable support threads.
  const { data: messages, error: messageError } = await admin
    .from("support_messages")
    .select("thread_id")
    .eq("workspace_id", workspaceId)
    .contains("attachments", [{ storageKey }])
    .limit(20);
  if (messageError || !messages || messages.length === 0) return false;

  const threadIds = [...new Set(messages.map((row) => row.thread_id).filter(Boolean))];
  if (threadIds.length === 0) return false;
  const { data: readableThread, error: threadError } = await admin
    .from("support_threads")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("created_by", userId)
    .in("id", threadIds)
    .limit(1)
    .maybeSingle();
  return !threadError && Boolean(readableThread);
}

export async function GET(request: NextRequest) {
  const parsed = parseAttachmentStorageKey(request.nextUrl.searchParams.get("key"));
  if (!parsed) {
    return NextResponse.json({ error: "Invalid or missing attachment key" }, { status: 400 });
  }

  const userResult = await requireUser(request);
  if (userResult instanceof NextResponse) return userResult;
  if (!(await userSupportAttachmentAccess(userResult.user.id, userResult.user.email, parsed.workspaceId, parsed.ownerUserId, parsed.key))) {
    return NextResponse.json({ error: "Attachment is not available to this user" }, { status: 403 });
  }

  const headers: HeadersInit = {
    Authorization: `Bearer ${assertEnv("SUPABASE_SERVICE_ROLE_KEY")}`,
    apikey: assertEnv("SUPABASE_SERVICE_ROLE_KEY"),
  };
  const range = request.headers.get("range");
  if (range && /^bytes=\d*-\d*$/.test(range)) {
    headers.Range = range;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STORAGE_RESPONSE_TIMEOUT_MS);
  let storageRes: Response;
  try {
    storageRes = await fetch(storageObjectUrl(parsed.key), {
      headers,
      signal: controller.signal,
    });
  } catch {
    const aborted = controller.signal.aborted;
    return NextResponse.json(
      { error: aborted ? "Attachment storage timed out" : "Attachment storage unavailable" },
      { status: aborted ? 504 : 502 },
    );
  } finally {
    clearTimeout(timer);
  }

  if (!storageRes.ok && storageRes.status !== 206) {
    return NextResponse.json(
      { error: storageRes.status === 404 ? "Attachment not found" : "Attachment storage failed" },
      { status: storageRes.status === 404 ? 404 : 502 },
    );
  }

  const responseHeaders = new Headers({
    "Cache-Control": "private, max-age=86400, immutable",
    "X-Content-Type-Options": "nosniff",
  });
  copyHeader(storageRes.headers, responseHeaders, "content-type");
  copyHeader(storageRes.headers, responseHeaders, "content-length");
  copyHeader(storageRes.headers, responseHeaders, "content-range");
  copyHeader(storageRes.headers, responseHeaders, "accept-ranges");
  if (!responseHeaders.has("content-type")) responseHeaders.set("Content-Type", "application/octet-stream");
  if (!responseHeaders.has("accept-ranges")) responseHeaders.set("Accept-Ranges", "bytes");

  return new Response(
    streamWithInactivityTimeout(
      storageRes.body,
      STREAM_INACTIVITY_TIMEOUT_MS,
      "Supabase support attachment stream",
      () => controller.abort(),
    ),
    {
      status: storageRes.status,
      headers: responseHeaders,
    },
  );
}
