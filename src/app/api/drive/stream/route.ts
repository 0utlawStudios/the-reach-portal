import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAccessToken, getFileMetadata } from "@/lib/google-drive";

export const maxDuration = 60; // Fluid Compute — stays alive while streaming

// Allow-list of origins permitted to stream Drive content. Production app +
// localhost dev. CORS:* was a P0 finding (anonymous cross-site streaming).
const SITE_ORIGIN = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").origin;
  } catch {
    return "http://localhost:3000";
  }
})();

const ALLOWED_ORIGINS = new Set([
  SITE_ORIGIN,
  "http://localhost:3000",
  "http://localhost:3001",
]);

function corsHeadersFor(req: NextRequest): Record<string, string> {
  const origin = req.headers.get("origin") || "";
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : SITE_ORIGIN;
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

// SEC-003: Validate the request has SOME form of authentication context.
// `<img>` and `<video>` tags cannot carry an Authorization header, so we
// accept EITHER:
//   (a) a same-origin Referer matching ALLOWED_ORIGINS — proves the request
//       came from our own page that the user already authenticated into; OR
//   (b) an `Authorization: Bearer <supabase-jwt>` validated via admin.getUser.
// Neither present → 401. The CORS narrowing alone wasn't sufficient because
// it doesn't block a credentialled curl/script.
async function checkAuth(req: NextRequest): Promise<{ ok: boolean; authed: boolean }> {
  // (a) Referer check
  const referer = req.headers.get("referer") || "";
  let refOk = false;
  if (referer) {
    try {
      refOk = ALLOWED_ORIGINS.has(new URL(referer).origin);
    } catch {
      refOk = false;
    }
  }

  // (b) Bearer-token check
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  let tokenOk = false;
  if (token) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && serviceKey) {
      try {
        const admin = createClient(url, serviceKey, {
          auth: { autoRefreshToken: false, persistSession: false },
        });
        const { data, error } = await admin.auth.getUser(token);
        tokenOk = !error && !!data.user;
      } catch {
        tokenOk = false;
      }
    }
  }

  return { ok: refOk || tokenOk, authed: tokenOk };
}

// ─── Stream proxy with Range support ───
export async function GET(request: NextRequest) {
  const corsHeaders = corsHeadersFor(request);
  const fileId = request.nextUrl.searchParams.get("id");

  // SEC-009: Tightened to match drive/finalize — Drive file IDs are 20-80
  // char base64-url-ish strings. The old `/^[\w-]+$/` accepted any length.
  if (!fileId || !/^[a-zA-Z0-9_-]{20,80}$/.test(fileId)) {
    return new Response(JSON.stringify({ error: "Invalid or missing file ID" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  // SEC-003: Layered access gate. Previous note here said hard auth was not
  // possible because <img>/<video> tags can't send Authorization headers.
  // True — but those tags DO send a Referer, and that referer reliably comes
  // from our own page (which is already auth-walled at the app layer). So
  // accept either a same-origin Referer OR an explicit Bearer token. This
  // blocks the anonymous-curl / hot-link scraping vector while keeping
  // image/video tags working unchanged inside the app.
  const auth = await checkAuth(request);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  try {
    // Get file metadata for Content-Type and size.
    // PERF-003: metadata fetch and token mint are independent — run them
    // concurrently instead of sequentially.
    const [meta, token] = await Promise.all([getFileMetadata(fileId), getAccessToken()]);
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

    // SEC-003: Cache policy mirrors the auth path used. When the caller
    // proved themselves with a Bearer token the bytes can be cached for the
    // standard 1-day immutable window. When they only proved same-origin via
    // Referer we keep the byte cache out of intermediaries — the Referer
    // header doesn't ride along on subsequent retrievals.
    const cacheControl = auth.authed
      ? "private, max-age=86400, immutable"
      : "private, no-store";

    const responseHeaders: Record<string, string> = {
      "Content-Type": meta.mimeType,
      "Accept-Ranges": "bytes",
      "Cache-Control": cacheControl,
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
