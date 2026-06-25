import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require";
import { verifyAiAssetToken } from "@/lib/ai/asset-publish-url";
import { STREAM_INACTIVITY_TIMEOUT_MS, streamWithInactivityTimeout } from "@/lib/stream-inactivity-timeout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BUCKET = "ai-assets";
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

function parseAiAssetStorageKey(value: string | null): { key: string; workspaceId: string } | null {
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
  if (!WORKSPACE_ID_RE.test(workspaceId)) return null;
  return { key, workspaceId };
}

async function userHasWorkspaceAccess(userId: string, workspaceId: string): Promise<boolean> {
  const { data, error } = await adminClient()
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userId)
    .eq("workspace_id", workspaceId)
    .eq("status", "active")
    .maybeSingle();
  return !error && Boolean(data);
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

export async function GET(request: NextRequest) {
  const parsed = parseAiAssetStorageKey(request.nextUrl.searchParams.get("key"));
  if (!parsed) {
    return NextResponse.json({ error: "Invalid or missing AI asset key" }, { status: 400 });
  }

  const signed = Boolean(verifyAiAssetToken(parsed.key, request.nextUrl.searchParams.get("token")));
  if (!signed) {
    const userResult = await requireUser(request);
    if (userResult instanceof NextResponse) return userResult;
    if (!(await userHasWorkspaceAccess(userResult.user.id, parsed.workspaceId))) {
      return NextResponse.json({ error: "AI asset does not belong to this workspace" }, { status: 403 });
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
      { error: aborted ? "AI asset storage timed out" : "AI asset storage unavailable" },
      { status: aborted ? 504 : 502 },
    );
  } finally {
    clearTimeout(timer);
  }

  if (!storageRes.ok && storageRes.status !== 206) {
    return NextResponse.json(
      { error: storageRes.status === 404 ? "AI asset not found" : "AI asset storage failed" },
      { status: storageRes.status === 404 ? 404 : 502 },
    );
  }

  const responseHeaders = new Headers({
    "Cache-Control": signed ? "public, max-age=86400, immutable" : "private, max-age=86400, immutable",
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
      "Supabase AI asset stream",
      () => controller.abort(),
    ),
    {
    status: storageRes.status,
    headers: responseHeaders,
    },
  );
}
