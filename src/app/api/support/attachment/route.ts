import { NextRequest, NextResponse } from "next/server";
import { requireRole, type WorkspaceRole } from "@/lib/auth/require";
import { ALLOWED_DRIVE_ROLES } from "@/lib/drive-policy";

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

function parseAttachmentStorageKey(value: string | null): { key: string; workspaceId: string } | null {
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
  const parsed = parseAttachmentStorageKey(request.nextUrl.searchParams.get("key"));
  if (!parsed) {
    return NextResponse.json({ error: "Invalid or missing attachment key" }, { status: 400 });
  }

  const auth = await requireRole(request, ALLOWED_DRIVE_ROLES as readonly WorkspaceRole[]);
  if (auth instanceof NextResponse) return auth;
  if (parsed.workspaceId !== auth.workspaceId) {
    return NextResponse.json({ error: "Attachment does not belong to this workspace" }, { status: 403 });
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

  return new Response(storageRes.body, {
    status: storageRes.status,
    headers: responseHeaders,
  });
}
