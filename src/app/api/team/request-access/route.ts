import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getTransporter, getFromAddress, buildAdminNotificationHtml } from "@/lib/email-utils";
import { consume, getClientIp } from "@/lib/rate-limit";

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
    // Rate limit: 5 per minute per IP. Anti-spam for the public signup form.
    const ip = getClientIp(request);
    const ipCheck = await consume("request-access:ip", ip, 5, 60);
    if (!ipCheck.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429 },
      );
    }

    const body: RequestBody = await request.json();

    if (!body.name?.trim() || !body.email?.trim()) {
      return NextResponse.json({ error: "Name and email are required" }, { status: 400 });
    }

    const email = body.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
    }

    const admin = getAdminClient();

    // Anti-enumeration: always respond with success. Internally we still skip
    // the insert (and the admin notification) if the email already maps to a
    // team member or a pending request, so we don't spam admins or pile up
    // duplicates — but the response shape is identical for unknown emails.
    const { data: existingMember } = await admin
      .from("team_members")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    const { data: pendingReq } = await admin
      .from("signup_requests")
      .select("id")
      .eq("email", email)
      .eq("status", "pending")
      .maybeSingle();

    const alreadyKnown = !!existingMember || !!pendingReq;

    let insertErr: { message: string } | null = null;
    if (!alreadyKnown) {
      // Insert the request
      const res = await admin
        .from("signup_requests")
        .insert({
          name: body.name.trim(),
          email,
          phone: body.phone || null,
          company: body.company || null,
          reason: body.reason || null,
          status: "pending",
        });
      insertErr = res.error;

      if (insertErr) {
        console.error("[request-access] Insert failed:", insertErr.message);
        // Still respond 200 to preserve anti-enumeration. Caller can retry; we
        // surface the failure only in server logs.
      }
    } else {
      console.log(`[request-access] Skipped duplicate request for ${email}`);
    }

    // ─── Email admins about the new request (only for genuinely new emails) ───
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    if (smtpUser && smtpPass && !alreadyKnown && !insertErr) {
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
      } catch (emailErr: unknown) {
        console.error("[request-access] Email FAILED:", emailErr instanceof Error ? emailErr.message : emailErr);
      }
    }

    return NextResponse.json({ success: true, smtpConfigured: !!(smtpUser && smtpPass) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[request-access]", message);
    return NextResponse.json({ error: message.slice(0, 200) }, { status: 500 });
  }
}
