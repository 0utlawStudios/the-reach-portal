import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

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

    // Email admin about the new request
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    console.log("[request-access] SMTP check:", { hasUser: !!smtpUser, hasPass: !!smtpPass, user: smtpUser });
    if (smtpUser && smtpPass) {
      try {
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST || "smtp.gmail.com",
          port: Number(process.env.SMTP_PORT || 465),
          secure: true,
          auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
        });

        const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://ten80tensmm.vercel.app";

        // Find admins/owners to notify
        const { data: admins } = await admin
          .from("team_members")
          .select("email")
          .in("role", ["owner", "admin"]);

        const adminEmails = admins?.map((a) => a.email).filter(Boolean) || [];

        if (adminEmails.length > 0) {
          await transporter.sendMail({
            from: `"Ten80Ten Portal" <${process.env.SMTP_USER}>`,
            to: adminEmails.join(", "),
            subject: `New Access Request: ${body.name.trim()}`,
            html: `
              <div style="font-family: -apple-system, sans-serif; max-width: 520px; margin: 0 auto;">
                <div style="background: #0a0a0e; padding: 24px; border-radius: 12px 12px 0 0;">
                  <p style="color: #f97316; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; margin: 0;">New Access Request</p>
                </div>
                <div style="background: #fff; padding: 24px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
                  <p style="font-size: 14px; margin: 0 0 12px;"><strong>${body.name.trim()}</strong> is requesting access to the portal.</p>
                  <table style="font-size: 13px; color: #374151;">
                    <tr><td style="padding: 4px 12px 4px 0; color: #9ca3af;">Email</td><td>${email}</td></tr>
                    ${body.phone ? `<tr><td style="padding: 4px 12px 4px 0; color: #9ca3af;">WhatsApp</td><td>${body.phone}</td></tr>` : ""}
                    ${body.company ? `<tr><td style="padding: 4px 12px 4px 0; color: #9ca3af;">Company</td><td>${body.company}</td></tr>` : ""}
                    ${body.reason ? `<tr><td style="padding: 4px 12px 4px 0; color: #9ca3af;">Reason</td><td>${body.reason}</td></tr>` : ""}
                  </table>
                  <a href="${siteUrl}" style="display: inline-block; margin-top: 16px; background: #ea580c; color: white; text-decoration: none; padding: 10px 24px; border-radius: 8px; font-size: 13px; font-weight: 600;">Review in Portal</a>
                </div>
              </div>
            `,
          });
        }
        console.log("[request-access] Email sent to:", adminEmails);
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
