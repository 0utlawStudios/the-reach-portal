import nodemailer from "nodemailer";

// ─── Shared Utilities ───

export function getTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT || 465),
    secure: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

export function getFromAddress() {
  return `"Ten80Ten Social Media Management Portal" <${process.env.SMTP_USER}>`;
}

export function getSiteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL || "https://ten80tensmm.vercel.app";
}

// ─── Shared HTML Wrapper ───

function wrapEmail(content: string) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="max-width:540px;margin:40px auto;border-radius:16px;overflow:hidden;background:#ffffff;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
${content}
<div style="padding:24px 32px;text-align:center;background:#fafafa;border-top:1px solid #f0f0f0;">
  <p style="color:#999;font-size:11px;margin:0;">Ten80Ten &mdash; Social Media Management Portal</p>
  <p style="color:#bbb;font-size:10px;margin:6px 0 0;">Developed by Aldridge</p>
</div>
</div>
</body>
</html>`;
}

function ctaButton(label: string, url: string, gradient = "background:linear-gradient(135deg,#ea580c,#f59e0b);") {
  return `<a href="${url}" style="display:inline-block;${gradient}color:#fff;text-decoration:none;padding:16px 48px;border-radius:12px;font-size:15px;font-weight:800;letter-spacing:0.02em;">${label}</a>`;
}

function roleBadge(role: string) {
  return `<span style="display:inline-block;background:#f59e0b22;color:#f59e0b;padding:4px 12px;border-radius:6px;font-size:11px;font-weight:700;text-transform:capitalize;">${role}</span>`;
}

// ─── Template 1: Invite Email ───

export function buildInviteEmailHtml(name: string, role: string, confirmUrl: string) {
  return wrapEmail(`
<div style="background:linear-gradient(135deg,#ea580c,#f59e0b);padding:32px;text-align:center;">
  <div style="width:56px;height:56px;margin:0 auto 16px;background:rgba(255,255,255,0.2);border-radius:14px;line-height:56px;font-size:24px;font-weight:900;color:#fff;">T</div>
  <h1 style="color:#fff;font-size:22px;font-weight:800;margin:0;">You're Invited!</h1>
  <p style="color:rgba(255,255,255,0.8);font-size:13px;margin:8px 0 0;">Join the Ten80Ten content team</p>
</div>
<div style="background:#fff;padding:32px;">
  <p style="color:#111;font-size:15px;line-height:1.6;margin:0 0 16px;">Hi <strong>${name}</strong>,</p>
  <p style="color:#374151;font-size:14px;line-height:1.6;margin:0 0 16px;">You've been invited to join the <strong>Ten80Ten</strong> Social Media Management Portal as:</p>
  <div style="text-align:center;margin:12px 0;">${roleBadge(role)}</div>
  <p style="color:#374151;font-size:14px;line-height:1.6;margin:0 0 24px;">Click the button below to set up your password and complete your profile.</p>
  <div style="text-align:center;margin:28px 0;">${ctaButton("ACCEPT INVITATION", confirmUrl)}</div>
  <p style="color:#9ca3af;font-size:11px;text-align:center;margin:20px 0 0;">This link will expire in 24 hours.</p>
</div>`);
}

// ─── Template 2: Approval Email ───

export function buildApprovalEmailHtml(name: string, role: string, confirmUrl: string) {
  return wrapEmail(`
<div style="background:linear-gradient(135deg,#059669,#10b981);padding:32px;text-align:center;">
  <div style="width:56px;height:56px;margin:0 auto 16px;background:rgba(255,255,255,0.2);border-radius:14px;line-height:56px;font-size:28px;color:#fff;">&#10003;</div>
  <h1 style="color:#fff;font-size:22px;font-weight:800;margin:0;">Request Approved!</h1>
  <p style="color:rgba(255,255,255,0.8);font-size:13px;margin:8px 0 0;">Welcome to the Ten80Ten team</p>
</div>
<div style="background:#fff;padding:32px;">
  <p style="color:#111;font-size:15px;line-height:1.6;margin:0 0 16px;">Hi <strong>${name}</strong>,</p>
  <p style="color:#374151;font-size:14px;line-height:1.6;margin:0 0 16px;">Great news! Your access request has been approved. You've been assigned the role:</p>
  <div style="text-align:center;margin:12px 0;">${roleBadge(role)}</div>
  <p style="color:#374151;font-size:14px;line-height:1.6;margin:0 0 24px;">Click below to set up your account and start using the portal.</p>
  <div style="text-align:center;margin:28px 0;">${ctaButton("SET UP YOUR ACCOUNT", confirmUrl, "background:linear-gradient(135deg,#059669,#10b981);")}</div>
  <p style="color:#9ca3af;font-size:11px;text-align:center;margin:20px 0 0;">This link will expire in 24 hours.</p>
</div>`);
}

// ─── Template 3: Password Reset Email ───

export function buildPasswordResetEmailHtml(confirmUrl: string) {
  return wrapEmail(`
<div style="background:linear-gradient(135deg,#d97706,#f59e0b);padding:32px;text-align:center;">
  <div style="width:56px;height:56px;margin:0 auto 16px;background:rgba(255,255,255,0.2);border-radius:14px;line-height:56px;font-size:24px;font-weight:900;color:#fff;">&#128274;</div>
  <h1 style="color:#fff;font-size:22px;font-weight:800;margin:0;">Reset Your Password</h1>
  <p style="color:rgba(255,255,255,0.8);font-size:13px;margin:8px 0 0;">Ten80Ten Portal</p>
</div>
<div style="background:#fff;padding:32px;">
  <p style="color:#374151;font-size:14px;line-height:1.6;margin:0 0 16px;">We received a request to reset your password for the Ten80Ten Social Media Management Portal.</p>
  <p style="color:#374151;font-size:14px;line-height:1.6;margin:0 0 24px;">Click the button below to choose a new password.</p>
  <div style="text-align:center;margin:28px 0;">${ctaButton("RESET PASSWORD", confirmUrl, "background:linear-gradient(135deg,#d97706,#f59e0b);")}</div>
  <p style="color:#9ca3af;font-size:11px;text-align:center;margin:20px 0 0;">This link expires in 1 hour. If you didn't request this, ignore this email.</p>
</div>`);
}

// ─── Admin Notification (New Access Request) ───

export function buildAdminNotificationHtml(requester: { name: string; email: string; phone?: string | null; company?: string | null; reason?: string | null }) {
  const siteUrl = getSiteUrl();
  const rows = [
    `<tr><td style="padding:6px 16px 6px 0;color:#9ca3af;font-size:13px;">Email</td><td style="font-size:13px;color:#374151;">${requester.email}</td></tr>`,
    requester.phone ? `<tr><td style="padding:6px 16px 6px 0;color:#9ca3af;font-size:13px;">WhatsApp</td><td style="font-size:13px;color:#374151;">${requester.phone}</td></tr>` : "",
    requester.company ? `<tr><td style="padding:6px 16px 6px 0;color:#9ca3af;font-size:13px;">Company</td><td style="font-size:13px;color:#374151;">${requester.company}</td></tr>` : "",
    requester.reason ? `<tr><td style="padding:6px 16px 6px 0;color:#9ca3af;font-size:13px;">Reason</td><td style="font-size:13px;color:#374151;">${requester.reason}</td></tr>` : "",
  ].filter(Boolean).join("");

  return wrapEmail(`
<div style="background:#0a0a0e;padding:28px 32px;">
  <p style="color:#f59e0b;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;margin:0;">New Access Request</p>
</div>
<div style="background:#fff;padding:32px;">
  <p style="color:#111;font-size:15px;line-height:1.6;margin:0 0 16px;"><strong>${requester.name}</strong> is requesting access to the portal.</p>
  <table style="margin:16px 0 24px;">${rows}</table>
  <div style="text-align:center;">${ctaButton("Review in Portal", siteUrl)}</div>
</div>`);
}
