"use client";

import { AuthProvider } from "@/lib/auth-context";
import { ThemeEngineProvider } from "@/lib/theme-engine";
import { AppShell } from "@/components/app-shell";

export default function Home() {
  return (
    <ThemeEngineProvider>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </ThemeEngineProvider>
  );
}
