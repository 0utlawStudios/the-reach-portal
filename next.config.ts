import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
  },
  devIndicators: false,
  serverExternalPackages: ["nodemailer"],
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        // Baseline security headers on every response.
        // SEC-012: CSP is shipped in Report-Only mode — browsers report
        // violations without blocking, so this is non-destructive. Promote
        // to an enforcing `Content-Security-Policy` once reports are clean.
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Content-Security-Policy-Report-Only",
            value: "default-src 'self'; img-src 'self' data: https://*.supabase.co https://lh3.googleusercontent.com; media-src 'self'; connect-src 'self' https://*.supabase.co; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'self'",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
