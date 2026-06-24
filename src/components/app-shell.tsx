"use client";

import dynamic from "next/dynamic";
import { Loader2, Lock, RefreshCw } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { ThemeProvider } from "@/lib/theme-context";

const AuthenticatedAppShell = dynamic(
  () => import("./authenticated-app-shell").then((mod) => mod.AuthenticatedAppShell),
  {
    loading: () => <AppLoadingScreen label="Loading workspace" />,
  },
);
const LoginScreen = dynamic(() => import("./login-screen").then((mod) => mod.LoginScreen), {
  loading: () => <AppLoadingScreen label="Loading sign in" />,
});

function AppLoadingScreen({ label }: { label: string }) {
  return (
    <div className="min-h-dvh bg-[#09090b] flex items-center justify-center p-4" role="status" aria-label={label}>
      <div className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-[#131316] px-4 py-3 text-[13px] font-medium text-gray-300 shadow-2xl">
        <Loader2 className="h-4 w-4 animate-spin text-orange-400" />
        <span>{label}</span>
      </div>
    </div>
  );
}

export function AppShell() {
  const { isAuthenticated, isLoading, currentUser, provisionResult, provisionStatus, provisionMessage, logout } = useAuth();

  if (isLoading) return <AppLoadingScreen label="Checking session" />;
  if (!isAuthenticated) return <LoginScreen />;

  if (provisionStatus !== "active") {
    return (
      <div className="min-h-dvh bg-[#09090b] flex items-center justify-center p-4">
        <div className="w-full max-w-[420px] rounded-2xl border border-white/[0.08] bg-[#131316] p-6 text-center shadow-2xl">
          <div className="w-12 h-12 mx-auto rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center mb-4">
            {provisionStatus === "unknown" ? (
              <Loader2 className="w-5 h-5 text-orange-400 animate-spin" />
            ) : (
              <Lock className="w-5 h-5 text-orange-400" />
            )}
          </div>
          <h1 className="text-[17px] font-bold text-white">
            {provisionStatus === "unknown" ? "Checking workspace access" : "Workspace access not active"}
          </h1>
          <p className="text-[13px] text-gray-400 mt-2 leading-relaxed">
            {provisionStatus === "unknown"
              ? "Confirming your team membership before loading shared content."
              : provisionMessage || "Your invitation is not active yet. Ask an admin to resend the invite or complete setup again."}
          </p>
          {provisionStatus !== "unknown" && (
            <div className="flex gap-2 mt-5">
              {provisionStatus === "pending" ? (
                <button
                  onClick={() => { window.location.href = "/auth/setup"; }}
                  className="flex-1 h-10 rounded-lg bg-[#975428] hover:bg-[#7f4521] text-[#E1DFD5] text-[12px] font-semibold flex items-center justify-center gap-2 cursor-pointer"
                >
                  Complete Setup
                </button>
              ) : (
                <button
                  onClick={() => window.location.reload()}
                  className="flex-1 h-10 rounded-lg bg-[#975428] hover:bg-[#7f4521] text-[#E1DFD5] text-[12px] font-semibold flex items-center justify-center gap-2 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />Refresh
                </button>
              )}
              <button
                onClick={logout}
                className="flex-1 h-10 rounded-lg border border-white/[0.08] text-gray-300 hover:bg-white/[0.04] text-[12px] font-semibold cursor-pointer"
              >
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <ThemeProvider email={currentUser.email} workspaceId={provisionResult?.workspaceId}>
      <AuthenticatedAppShell />
    </ThemeProvider>
  );
}
