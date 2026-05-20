import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// SEC-005: Narrow VALID_TYPES to only the two flows this route actually
// supports. Permitting "magiclink"/"signup"/"email" allowed a confirmed-link
// recipient to land on /auth/setup with a full session, bypassing the
// dedicated sign-in flow.
const VALID_TYPES = ["invite", "recovery"] as const;
type ValidType = (typeof VALID_TYPES)[number];

function isValidType(type: string): type is ValidType {
  return (VALID_TYPES as readonly string[]).includes(type);
}

// SEC-004: Attach the freshly-minted session as short-lived HttpOnly cookies
// on the redirect, AND keep them in the URL fragment so the client SDK can
// also hydrate the session. Fragments are NEVER sent to the server in the
// Referer header and don't appear in standard access logs, unlike query
// strings (which were the previous transport — see git blame).
//
// The downstream /auth/setup and /auth/reset-password pages read these tokens
// from `window.location.hash` and scrub the fragment immediately after
// consuming it, so the credentials never persist in the browser address bar
// or history.
const TOKEN_COOKIE_MAX_AGE = 600; // 10 minutes
function attachTokenCookies(
  res: NextResponse,
  accessToken: string,
  refreshToken: string | null,
) {
  res.cookies.set("sb-access-token", accessToken, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: TOKEN_COOKIE_MAX_AGE,
  });
  if (refreshToken) {
    res.cookies.set("sb-refresh-token", refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: TOKEN_COOKIE_MAX_AGE,
    });
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://smm.ten80ten.com";

  if (!tokenHash || !type) {
    return NextResponse.redirect(`${siteUrl}?error=missing_token`);
  }

  // Reject unknown types
  if (!isValidType(type)) {
    return NextResponse.redirect(`${siteUrl}?error=invalid_type`);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.redirect(`${siteUrl}?error=config`);
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  // Verify the OTP token
  const { data, error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type,
  });

  if (error) {
    console.error("[auth/confirm] Token verification failed:", error.message);
    return NextResponse.redirect(`${siteUrl}?error=invalid_token`);
  }

  const accessToken = data?.session?.access_token;
  const refreshToken = data?.session?.refresh_token;

  if (!accessToken) {
    return NextResponse.redirect(`${siteUrl}?error=no_session`);
  }

  // Tokens go into the URL fragment (not the query string) so they aren't
  // captured by Referer headers or server access logs. We ALSO mirror them
  // into short-lived HttpOnly cookies as a fallback transport for the
  // downstream client pages (see Wave B follow-up).
  const params = new URLSearchParams({ access_token: accessToken });
  if (refreshToken) params.set("refresh_token", refreshToken);

  if (type === "invite") {
    const res = NextResponse.redirect(`${siteUrl}/auth/setup#${params.toString()}`);
    attachTokenCookies(res, accessToken, refreshToken ?? null);
    return res;
  }

  // type === "recovery" — exhaustive over VALID_TYPES
  const res = NextResponse.redirect(`${siteUrl}/auth/reset-password#${params.toString()}`);
  attachTokenCookies(res, accessToken, refreshToken ?? null);
  return res;
}
