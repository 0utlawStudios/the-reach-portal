"use client";

import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";
import { Lock, CheckCircle, AlertCircle, Eye, EyeOff } from "lucide-react";

function getSupabase(accessToken?: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const client = createClient(url, key, {
    global: accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined,
  });
  return client;
}

export default function SetupPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [userName, setUserName] = useState("");
  const [accessToken, setAccessToken] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("access_token");
    if (token) {
      setAccessToken(token);
      // Decode JWT to get user name
      try {
        const payload = JSON.parse(atob(token.split(".")[1]));
        setUserName(payload.user_metadata?.name || "");
      } catch { /* ignore */ }
    }
  }, []);

  const isValid = password.length >= 8 && password === confirm;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid || loading || !accessToken) return;

    setLoading(true);
    setError("");

    const supabase = getSupabase(accessToken);

    // Update the user's password
    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setError(updateError.message);
      setLoading(false);
      return;
    }

    // Get the user to find their email
    const { data: { user } } = await supabase.auth.getUser(accessToken);

    // Update team_members status from "pending" → "active"
    if (user?.email) {
      await supabase
        .from("team_members")
        .update({ status: "active" })
        .eq("email", user.email);
    }

    setSuccess(true);
    setLoading(false);

    // Redirect to dashboard after brief success message
    setTimeout(() => {
      window.location.href = "/";
    }, 2000);
  };

  if (success) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-[#0a0a0b] flex items-center justify-center p-4">
        <div className="w-full max-w-[400px] text-center space-y-4">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center">
            <CheckCircle className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
          </div>
          <h1 className="text-[20px] font-bold text-gray-900 dark:text-white">You&apos;re all set!</h1>
          <p className="text-[13px] text-gray-500 dark:text-gray-400">Password created. Redirecting to dashboard...</p>
          <div className="w-8 h-8 mx-auto border-3 border-gray-200 border-t-blue-600 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0a0a0b] flex items-center justify-center p-4">
      <div className="w-full max-w-[420px]">
        <div className="bg-white dark:bg-[#151518] rounded-2xl border border-gray-200 dark:border-white/[0.08] shadow-xl overflow-hidden">
          {/* Header */}
          <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
                <Lock className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-[16px] font-bold text-white">Set Your Password</h1>
                <p className="text-[12px] text-white/70">
                  {userName ? `Welcome, ${userName}!` : "Welcome to Ten80Ten"}
                </p>
              </div>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <p className="text-[12px] text-gray-500 dark:text-gray-400">
              Create a secure password for your account. You&apos;ll use this to sign in going forward.
            </p>

            {error && (
              <div className="flex items-center gap-2 bg-red-50 dark:bg-red-500/5 border border-red-200 dark:border-red-500/20 rounded-lg p-3">
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                <p className="text-[11px] text-red-700 dark:text-red-400">{error}</p>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.08em]">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 8 characters"
                  className="w-full h-10 px-3 pr-10 rounded-lg bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] text-[13px] text-gray-800 dark:text-gray-200 outline-none focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-500/30 transition-all"
                  autoFocus
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 cursor-pointer">
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {password.length > 0 && password.length < 8 && (
                <p className="text-[10px] text-amber-500">Must be at least 8 characters</p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.08em]">Confirm Password</label>
              <input
                type={showPassword ? "text" : "password"}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Re-enter your password"
                className="w-full h-10 px-3 rounded-lg bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] text-[13px] text-gray-800 dark:text-gray-200 outline-none focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-500/30 transition-all"
              />
              {confirm.length > 0 && password !== confirm && (
                <p className="text-[10px] text-red-500">Passwords don&apos;t match</p>
              )}
            </div>

            <button
              type="submit"
              disabled={!isValid || loading || !accessToken}
              className="w-full h-11 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-[13px] font-semibold shadow-sm shadow-blue-500/20 disabled:opacity-40 transition-all cursor-pointer flex items-center justify-center gap-2"
            >
              {loading ? (
                <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Setting up...</>
              ) : (
                <><Lock className="w-4 h-4" />Create Password & Enter Dashboard</>
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-[10px] text-gray-400 dark:text-gray-600 mt-4">
          Ten80Ten Social Media Management Portal
        </p>
      </div>
    </div>
  );
}
