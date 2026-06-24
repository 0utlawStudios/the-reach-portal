import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 5;

const ACCESS_COOKIE_MAX_AGE = 60 * 60; // Supabase access tokens are short-lived; refresh rewrites this.

function clearSessionCookie(res: NextResponse): NextResponse {
  res.cookies.delete("sb-access-token");
  return res;
}

function setAccessCookie(res: NextResponse, accessToken: string): NextResponse {
  res.cookies.set("sb-access-token", accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ACCESS_COOKIE_MAX_AGE,
  });
  return res;
}

export async function POST(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) {
    return clearSessionCookie(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
  }

  try {
    const admin = createServiceRoleClient();
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data.user) {
      return clearSessionCookie(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    }
    return setAccessCookie(NextResponse.json({ ok: true }), token);
  } catch {
    return NextResponse.json({ error: "Session cookie sync failed" }, { status: 500 });
  }
}

export async function DELETE() {
  return clearSessionCookie(NextResponse.json({ ok: true }));
}
