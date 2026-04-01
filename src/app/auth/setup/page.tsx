"use client";

import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";
import { Lock, CheckCircle, AlertCircle, Eye, EyeOff, User, Phone, Shield } from "lucide-react";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, key);
}

export default function SetupPasswordPage() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    async function initSession() {
      const params = new URLSearchParams(window.location.search);
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");

      if (accessToken) {
        // Establish a proper Supabase session
        const supabase = getSupabase();
        const { error: sessionErr } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken || "",
        });
        if (sessionErr) {
          setError("Session expired or invalid. Please request a new invite link.");
          return;
        }
        setReady(true);

        // Extract invite metadata from JWT
        try {
          const payload = JSON.parse(atob(accessToken.split(".")[1]));
          const meta = payload.user_metadata || {};
          setInviteEmail(payload.email || meta.email || "");
          setInviteRole(meta.role || "");
          const name = meta.name || "";
          if (name.includes(" ")) {
            setFirstName(name.split(" ")[0]);
            setLastName(name.split(" ").slice(1).join(" "));
          } else {
            setFirstName(name);
          }
        } catch { /* ignore */ }
      }
    }
    initSession();
  }, []);

  const isValid = firstName.trim() && lastName.trim() && password.length >= 8 && password === confirm;

  const inputClass = "w-full h-11 px-3 rounded-xl bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] text-[13px] text-gray-800 dark:text-gray-200 placeholder:text-gray-400 dark:placeholder:text-gray-600 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 dark:focus:ring-orange-500/10 transition-all";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid || loading || !ready) return;
    setLoading(true);
    setError("");

    const fullName = `${firstName.trim()} ${lastName.trim()}`;
    const cleanPhone = whatsapp.trim().replace(/[^0-9+]/g, "");
    const supabase = getSupabase();

    // Update password
    const { error: pwError } = await supabase.auth.updateUser({
      password,
      data: { name: fullName, phone: cleanPhone },
    });
    if (pwError) {
      const msg = pwError.message.includes("different from the old")
        ? "Please choose a different password."
        : pwError.message;
      setError(msg);
      setLoading(false);
      return;
    }

    // Get user email
    const { data: { user } } = await supabase.auth.getUser();

    // Update team_members: status → active, name, phone
    if (user?.email) {
      await supabase
        .from("team_members")
        .update({
          status: "active",
          name: fullName,
          phone: cleanPhone || null,
        })
        .eq("email", user.email);
    }

    // Sign out so user must log in with their new credentials
    await supabase.auth.signOut();

    setSuccess(true);
    setLoading(false);
    setTimeout(() => { window.location.href = "/"; }, 2000);
  };

  if (success) {
    return (
      <div className="min-h-screen bg-[#f8f9fb] dark:bg-[#09090b] flex items-center justify-center p-4">
        <div className="w-full max-w-[400px] text-center space-y-4">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center">
            <CheckCircle className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
          </div>
          <h1 className="text-[20px] font-bold text-gray-900 dark:text-white">You&apos;re all set!</h1>
          <p className="text-[13px] text-gray-500 dark:text-gray-400">Account created. Redirecting to login...</p>
          <div className="w-8 h-8 mx-auto border-3 border-gray-200 border-t-orange-500 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8f9fb] dark:bg-[#09090b] flex items-center justify-center p-4">
      <div className="w-full max-w-[460px]">
        <div className="bg-white dark:bg-[#131316] rounded-2xl border border-gray-200/80 dark:border-white/[0.06] shadow-[0_1px_3px_rgba(0,0,0,0.04),0_6px_24px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.2),0_6px_24px_rgba(0,0,0,0.15)] overflow-hidden">

          {/* Header */}
          <div className="bg-gradient-to-r from-orange-500 to-orange-600 px-7 py-6">
            <div className="flex items-center gap-4">
              <img src="/ten80ten-logo.png" alt="Ten80Ten" className="w-10 h-10 rounded-xl object-contain bg-white/20 backdrop-blur-sm p-1.5" />
              <div>
                <h1 className="text-[18px] font-bold text-white tracking-tight">Complete Your Profile</h1>
                <p className="text-[12px] text-white/70 mt-0.5">Welcome to the Ten80Ten team</p>
              </div>
            </div>
          </div>

          {/* Invite info badge */}
          {(inviteEmail || inviteRole) && (
            <div className="mx-6 mt-5 flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 dark:bg-white/[0.03] border border-gray-100 dark:border-white/[0.05]">
              <Shield className="w-3.5 h-3.5 text-orange-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                  Invited as <span className="font-semibold text-gray-700 dark:text-gray-300 capitalize">{inviteRole || "team member"}</span>
                  {inviteEmail && <span className="text-gray-400"> · {inviteEmail}</span>}
                </p>
              </div>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-6 pt-4 space-y-4">
            {error && (
              <div className="flex items-center gap-2 bg-red-50 dark:bg-red-500/5 border border-red-200 dark:border-red-500/20 rounded-xl p-3">
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                <p className="text-[11px] text-red-700 dark:text-red-400">{error}</p>
              </div>
            )}

            {/* Name row */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em]">First Name <span className="text-red-400">*</span></label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300 dark:text-gray-600" />
                  <input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="First" className={`${inputClass} pl-10`} autoFocus />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em]">Last Name <span className="text-red-400">*</span></label>
                <input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Last" className={inputClass} />
              </div>
            </div>

            {/* WhatsApp */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em]">WhatsApp Number</label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300 dark:text-gray-600" />
                <input type="tel" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="+63 912 345 6789" className={`${inputClass} pl-10 font-mono`} />
              </div>
              <p className="text-[10px] text-gray-400">Include country code. Used for team communication.</p>
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em]">Password <span className="text-red-400">*</span></label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300 dark:text-gray-600" />
                <input type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Minimum 8 characters" className={`${inputClass} pl-10 pr-10`} />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 cursor-pointer">
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {password.length > 0 && password.length < 8 && <p className="text-[10px] text-amber-500">Must be at least 8 characters</p>}
            </div>

            {/* Confirm */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em]">Confirm Password <span className="text-red-400">*</span></label>
              <input type={showPassword ? "text" : "password"} value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Re-enter password" className={inputClass} />
              {confirm.length > 0 && password !== confirm && <p className="text-[10px] text-red-500">Passwords don&apos;t match</p>}
            </div>

            <button type="submit" disabled={!isValid || loading} className="w-full h-11 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-[13px] font-bold shadow-lg shadow-orange-500/20 disabled:opacity-40 transition-all cursor-pointer flex items-center justify-center gap-2">
              {loading ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Setting up...</> : "Create Account & Enter Dashboard"}
            </button>
          </form>
        </div>

        <p className="text-center text-[10px] text-gray-400 dark:text-gray-600 mt-4">Ten80Ten Social Media Management Portal</p>
      </div>
    </div>
  );
}
