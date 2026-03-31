import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getTransporter, getFromAddress, buildAdminNotificationHtml } from "@/lib/email-utils";

export const maxDuration = 10;

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase admin credentials not configured");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

interface RequestBody {
  name: string;
  email: string;
  phone?: string | null;
  company?: string | null;
  reason?: string | null;
}

export async function POST(request: NextRequest) {
  try {
    const body: RequestBody = await request.json();

    if (!body.name?.trim() || !body.email?.trim()) {
      return NextResponse.json({ error: "Name and email are required" }, { status: 400 });
    }

    const email = body.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
    }

    const admin = getAdminClient();

    // Check if already a team member
    const { data: existing } = await admin
      .from("team_members")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ error: "This email is already registered. Try signing in." }, { status: 409 });
    }

    // Check for duplicate pending request
    const { data: pendingReq } = await admin
      .from("signup_requests")
      .select("id")
      .eq("email", email)
      .eq("status", "pending")
      .maybeSingle();
    if (pendingReq) {
      return NextResponse.json({ error: "A request for this email is already pending review." }, { status: 409 });
    }

    // Insert the request
    const { error: insertErr } = await admin
      .from("signup_requests")
      .insert({
        name: body.name.trim(),
        email,
        phone: body.phone || null,
        company: body.company || null,
        reason: body.reason || null,
        status: "pending",
      });

    if (insertErr) {
      console.error("[request-access] Insert failed:", insertErr.message);
      return NextResponse.json({ error: "Failed to submit request" }, { status: 500 });
    }

    // ─── Email admins about the new request ───
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    if (smtpUser && smtpPass) {
      try {
        const transporter = getTransporter();

        // Find superadmins and admins to notify
        const { data: admins } = await admin
          .from("team_members")
          .select("email")
          .in("role", ["superadmin", "admin"]);

        const adminEmails = admins?.map((a) => a.email).filter(Boolean) || [];

        if (adminEmails.length > 0) {
          await transporter.sendMail({
            from: getFromAddress(),
            to: adminEmails.join(", "),
            subject: `New Access Request: ${body.name.trim()}`,
            html: buildAdminNotificationHtml({
              name: body.name.trim(),
              email,
              phone: body.phone,
              company: body.company,
              reason: body.reason,
            }),
          });
        }
      } catch (emailErr: any) {
        console.error("[request-access] Email FAILED:", emailErr?.message || emailErr);
      }
    }

    return NextResponse.json({ success: true, smtpConfigured: !!(smtpUser && smtpPass) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[request-access]", message);
    return NextResponse.json({ error: message.slice(0, 200) }, { status: 500 });
  }
}
