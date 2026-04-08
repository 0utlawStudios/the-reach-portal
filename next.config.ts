import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
  },
  devIndicators: false,
  serverExternalPackages: ["nodemailer"],
};

export default nextConfig;
