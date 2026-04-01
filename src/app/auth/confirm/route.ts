import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://ten80tensmm.vercel.app";

  if (!tokenHash || !type) {
    return NextResponse.redirect(`${siteUrl}?error=missing_token`);
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
    type: type as "invite" | "recovery" | "magiclink" | "signup" | "email",
  });

  if (error) {
    console.error("[auth/confirm] Token verification failed:", error.message);
    return NextResponse.redirect(`${siteUrl}?error=invalid_token`);
  }

  const accessToken = data?.session?.access_token;
  const refreshToken = data?.session?.refresh_token;

  // Route based on type — pass both tokens so client can establish a full session
  if (type === "invite" && accessToken) {
    const params = new URLSearchParams({ access_token: accessToken });
    if (refreshToken) params.set("refresh_token", refreshToken);
    return NextResponse.redirect(`${siteUrl}/auth/setup?${params.toString()}`);
  }

  if (type === "recovery" && accessToken) {
    const params = new URLSearchParams({ access_token: accessToken });
    if (refreshToken) params.set("refresh_token", refreshToken);
    return NextResponse.redirect(`${siteUrl}/auth/reset-password?${params.toString()}`);
  }

  // Default: redirect to dashboard
  return NextResponse.redirect(`${siteUrl}?invite=accepted`);
}
