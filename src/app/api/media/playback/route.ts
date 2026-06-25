import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "@/lib/auth/require";
import { ALLOWED_DRIVE_ROLES } from "@/lib/drive-policy";
import { streamWithInactivityTimeout } from "@/lib/stream-inactivity-timeout";
import { parsePlaybackStorageKey } from "@/lib/media-access";
import { verifyPlaybackViewToken } from "@/lib/media-playback-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BUCKET = "media-playback";
const STORAGE_RESPONSE_TIMEOUT_MS = 45_000;

function assertEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
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

async function userCanReadPlaybackWorkspace(userId: string, workspaceId: string): Promise<boolean> {
  const admin = createClient(assertEnv("NEXT_PUBLIC_SUPABASE_URL"), assertEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await admin
    .from("workspace_members")
    .select("role")
    .eq("user_id", userId)
    .eq("workspace_id", workspaceId)
    .eq("status", "active")
    .maybeSingle();
  if (error || !data?.role) return false;
  return (ALLOWED_DRIVE_ROLES as readonly string[]).includes(String(data.role));
}

export async function GET(request: NextRequest) {
  const parsed = parsePlaybackStorageKey(request.nextUrl.searchParams.get("key"));
  if (!parsed) {
    return NextResponse.json({ error: "Invalid or missing playback key" }, { status: 400 });
  }

  const signedClaims = verifyPlaybackViewToken(parsed.key, request.nextUrl.searchParams.get("token"));
  if (signedClaims?.workspaceId !== parsed.workspaceId) {
    const userResult = await requireUser(request);
    if (userResult instanceof NextResponse) return userResult;
    if (!(await userCanReadPlaybackWorkspace(userResult.user.id, parsed.workspaceId))) {
      return NextResponse.json({ error: "Playback object does not belong to this workspace" }, { status: 403 });
    }
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
      { error: aborted ? "Playback storage timed out" : "Playback storage unavailable" },
      { status: aborted ? 504 : 502 },
    );
  } finally {
    clearTimeout(timer);
  }

  if (!storageRes.ok && storageRes.status !== 206) {
    return NextResponse.json(
      { error: storageRes.status === 404 ? "Playback object not found" : "Playback storage failed" },
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
  if (!responseHeaders.has("content-type")) responseHeaders.set("Content-Type", "video/mp4");
  if (!responseHeaders.has("accept-ranges")) responseHeaders.set("Accept-Ranges", "bytes");

  return new Response(
    streamWithInactivityTimeout(
      storageRes.body,
      STORAGE_RESPONSE_TIMEOUT_MS,
      "Supabase playback media stream",
      () => {
        console.error("[media/playback] Supabase playback media stream stalled");
        controller.abort();
      },
    ),
    {
      status: storageRes.status,
      headers: responseHeaders,
    },
  );
}
