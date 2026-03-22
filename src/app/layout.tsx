import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Ten80Ten SMM",
  description: "Social Media Management Platform for Ten80Ten",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Ten80Ten SMM",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#e5e7eb" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full`}>
      <head>
        <link rel="apple-touch-icon" href="/icon-192.png" />
      </head>
      <body suppressHydrationWarning className="min-h-full flex flex-col font-[family-name:var(--font-inter)]">
        {children}
        <script
          dangerouslySetInnerHTML={{
            __html: `if("serviceWorker"in navigator){navigator.serviceWorker.register("/sw.js")}`,
          }}
        />
      </body>
    </html>
  );
}
