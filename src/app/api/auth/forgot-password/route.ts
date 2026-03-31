import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getTransporter, getFromAddress, getSiteUrl, buildPasswordResetEmailHtml } from "@/lib/email-utils";

export const maxDuration = 10;

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase admin credentials not configured");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();

    // ALWAYS return success to prevent email enumeration
    const successResponse = NextResponse.json({ success: true });

    if (!email?.trim()) return successResponse;

    const cleanEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return successResponse;

    const admin = getAdminClient();

    // Generate recovery link (no email sent by Supabase)
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "recovery",
      email: cleanEmail,
    });

    if (linkErr || !linkData?.properties?.hashed_token) {
      // Don't reveal that the email doesn't exist
      console.error("[forgot-password] generateLink failed:", linkErr?.message);
      return successResponse;
    }

    // Build our own confirmation URL
    const siteUrl = getSiteUrl();
    const tokenHash = linkData.properties.hashed_token;
    const confirmUrl = `${siteUrl}/auth/confirm?token_hash=${tokenHash}&type=recovery`;

    // Send branded password reset email
    try {
      const transporter = getTransporter();
      await transporter.sendMail({
        from: getFromAddress(),
        to: cleanEmail,
        subject: "Reset your Ten80Ten password",
        html: buildPasswordResetEmailHtml(confirmUrl),
      });
    } catch (emailErr: any) {
      console.error("[forgot-password] Email send failed:", emailErr?.message);
    }

    return successResponse;
  } catch (err: unknown) {
    console.error("[forgot-password]", err instanceof Error ? err.message : err);
    // Always return success (anti-enumeration)
    return NextResponse.json({ success: true });
  }
}
