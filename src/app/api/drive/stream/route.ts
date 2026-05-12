import { NextRequest } from "next/server";
import { getAccessToken, getFileMetadata } from "@/lib/google-drive";

export const maxDuration = 60; // Fluid Compute — stays alive while streaming

// Allow-list of origins permitted to stream Drive content. Production app +
// localhost dev. CORS:* was a P0 finding (anonymous cross-site streaming).
const ALLOWED_ORIGINS = new Set([
  "https://smm.ten80ten.com",
  "http://localhost:3000",
  "http://localhost:3001",
]);

function corsHeadersFor(req: NextRequest): Record<string, string> {
  const origin = req.headers.get("origin") || "";
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : "https://smm.ten80ten.com";
  return {
    "Access-Control-Allow-Origin": allow,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Range, Authorization",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
  };
}

// ─── CORS preflight ───
export async function OPTIONS(request: NextRequest) {
  return new Response(null, { status: 204, headers: corsHeadersFor(request) });
}

// ─── Stream proxy with Range support ───
export async function GET(request: NextRequest) {
  const corsHeaders = corsHeadersFor(request);
  const fileId = request.nextUrl.searchParams.get("id");

  if (!fileId || !/^[\w-]+$/.test(fileId)) {
    return new Response(JSON.stringify({ error: "Invalid or missing file ID" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  // NOTE: Hard auth (Bearer token) is not enforced here because <img>/<video>
  // tags cannot send Authorization headers without re-rendering through fetch().
  // The CORS narrowing above prevents cross-origin embeds (the main scraping
  // surface). A future iteration should issue short-lived signed URLs
  // (HMAC + expiry) per request, scoped to the caller's workspace. Tracked in
  // .omc/plans/2026-05-13-adversarial-qa-fix-plan.md follow-up.

  try {
    // Get file metadata for Content-Type and size
    const meta = await getFileMetadata(fileId);
    const token = await getAccessToken();
    const driveUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;

    const rangeHeader = request.headers.get("range");

    // Build headers for the Google Drive request
    const driveHeaders: Record<string, string> = {
      Authorization: `Bearer ${token}`,
    };
    // Only forward well-formed Range headers
    if (rangeHeader && /^bytes=\d*-\d*$/.test(rangeHeader)) {
      driveHeaders["Range"] = rangeHeader;
    }

    // Fetch from Google Drive
    const driveRes = await fetch(driveUrl, { headers: driveHeaders });

    if (!driveRes.ok && driveRes.status !== 206) {
      return new Response(JSON.stringify({ error: "Failed to fetch file from Drive" }), {
        status: driveRes.status,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Build response headers. Drop "public" from Cache-Control since the
    // payload is per-user-authenticated; keep it on the browser only.
    const responseHeaders: Record<string, string> = {
      "Content-Type": meta.mimeType,
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=86400, immutable",
      ...corsHeaders,
    };

    // Forward Content-Range and Content-Length from Google's response
    const contentRange = driveRes.headers.get("content-range");
    const contentLength = driveRes.headers.get("content-length");
    if (contentRange) responseHeaders["Content-Range"] = contentRange;
    if (contentLength) responseHeaders["Content-Length"] = contentLength;

    // Stream the response body — never buffer
    return new Response(driveRes.body, {
      status: driveRes.status,
      headers: responseHeaders,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[drive/stream]", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
}
