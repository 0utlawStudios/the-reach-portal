"use client";

import { AuthProvider } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";

export default function Home() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}
