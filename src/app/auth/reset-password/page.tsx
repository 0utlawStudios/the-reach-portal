"use client";

import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";
import { Lock, CheckCircle, AlertCircle, Eye, EyeOff, ArrowLeft, Shield } from "lucide-react";
import { motion } from "framer-motion";

const ease = [0.25, 0.4, 0.25, 1] as const;
const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.07, delayChildren: 0.1 } } };
const fadeUp = { hidden: { opacity: 0, y: 18 }, show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: ease as unknown as [number, number, number, number] } } };

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, key);
}

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [ready, setReady] = useState(false);

  // Establish a proper Supabase session from URL tokens
  useEffect(() => {
    async function initSession() {
      const params = new URLSearchParams(window.location.search);
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");
      if (accessToken) {
        const supabase = getSupabase();
        const { error: sessionErr } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken || "",
        });
        if (sessionErr) {
          setError("Reset link expired or invalid. Please request a new one.");
          return;
        }
        setReady(true);
      } else {
        setError("Missing reset token. Please use the link from your email.");
      }
    }
    initSession();
  }, []);

  const isValid = password.length >= 8 && password === confirm;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid || loading || !ready) return;
    setLoading(true);
    setError("");

    const supabase = getSupabase();
    const { error: pwError } = await supabase.auth.updateUser({ password });

    if (pwError) {
      setError(pwError.message);
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);
    setTimeout(() => { window.location.href = "/"; }, 2500);
  };

  if (success) {
    return (
      <div className="min-h-screen w-full lg:grid lg:grid-cols-[45fr_55fr]">
        <div className="relative flex flex-col min-h-screen lg:min-h-0 bg-white dark:bg-[#09090b]">
          <div className="flex-1 flex items-center justify-center px-8 lg:px-14 xl:px-20">
            <div className="w-full max-w-[360px] text-center space-y-5">
              <div className="w-16 h-16 mx-auto rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center">
                <CheckCircle className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
              </div>
              <h1 className="text-[24px] font-extrabold text-gray-900 dark:text-white tracking-[-0.03em]">Password updated!</h1>
              <p className="text-[14px] text-gray-500 dark:text-gray-400 leading-relaxed">
                Your password has been reset successfully. Redirecting...
              </p>
              <div className="w-8 h-8 mx-auto border-3 border-gray-200 border-t-orange-500 rounded-full animate-spin" />
            </div>
          </div>
        </div>
        <RightPanel />
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full lg:grid lg:grid-cols-[45fr_55fr]">
      {/* ═══ LEFT: Form ═══ */}
      <div className="relative flex flex-col min-h-screen lg:min-h-0 bg-white dark:bg-[#09090b]">
        <div className="flex-1 flex items-center justify-center px-8 lg:px-14 xl:px-20">
          <motion.div className="w-full max-w-[360px]" variants={stagger} initial="hidden" animate="show">
            {/* Logo + heading */}
            <motion.div className="mb-10" variants={fadeUp}>
              <img src="/ten80ten-logo.png" alt="Ten80Ten" className="w-[130px] h-auto object-contain mb-8" />
              <h1 className="text-[28px] font-extrabold text-gray-900 dark:text-white tracking-[-0.03em] leading-[1.1]">
                Set new password
              </h1>
              <p className="text-[14px] text-gray-400 dark:text-gray-500 mt-2.5">
                Choose a strong password for your account
              </p>
            </motion.div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Password */}
              <motion.div className="space-y-1.5" variants={fadeUp}>
                <label className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-[0.1em]">New Password</label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300 dark:text-gray-600" />
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder="Minimum 8 characters"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setError(""); }}
                    className="w-full h-[52px] pl-11 pr-11 rounded-xl bg-slate-50/80 dark:bg-white/[0.04] border border-gray-200/70 dark:border-white/[0.08] text-[14px] text-gray-900 dark:text-gray-100 placeholder:text-gray-300 dark:placeholder:text-gray-600 outline-none focus:bg-white dark:focus:bg-white/[0.06] focus:border-[#f59e0b] focus:ring-2 focus:ring-[#f59e0b]/15 transition-all"
                    autoFocus
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-300 dark:text-gray-600 hover:text-gray-500 cursor-pointer transition-colors">
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {password.length > 0 && password.length < 8 && <p className="text-[10px] text-amber-500">Must be at least 8 characters</p>}
              </motion.div>

              {/* Confirm */}
              <motion.div className="space-y-1.5" variants={fadeUp}>
                <label className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-[0.1em]">Confirm Password</label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300 dark:text-gray-600" />
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder="Re-enter your password"
                    value={confirm}
                    onChange={(e) => { setConfirm(e.target.value); setError(""); }}
                    className="w-full h-[52px] pl-11 pr-4 rounded-xl bg-slate-50/80 dark:bg-white/[0.04] border border-gray-200/70 dark:border-white/[0.08] text-[14px] text-gray-900 dark:text-gray-100 placeholder:text-gray-300 dark:placeholder:text-gray-600 outline-none focus:bg-white dark:focus:bg-white/[0.06] focus:border-[#f59e0b] focus:ring-2 focus:ring-[#f59e0b]/15 transition-all"
                  />
                </div>
                {confirm.length > 0 && password !== confirm && <p className="text-[10px] text-red-500">Passwords don't match</p>}
              </motion.div>

              {error && (
                <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="flex items-center gap-2 bg-red-50 dark:bg-red-500/5 border border-red-200 dark:border-red-500/20 rounded-xl px-3.5 py-2.5">
                  <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                  <span className="text-[12px] text-red-600 dark:text-red-400">{error}</span>
                </motion.div>
              )}

              <motion.div variants={fadeUp}>
                <button
                  type="submit"
                  disabled={!isValid || loading}
                  className="w-full h-[52px] rounded-xl bg-[#f59e0b] hover:bg-orange-500 active:bg-orange-600 hover:-translate-y-0.5 text-white text-[14px] font-bold shadow-lg shadow-[#f59e0b]/25 hover:shadow-xl hover:shadow-[#f59e0b]/30 disabled:opacity-40 disabled:shadow-none disabled:hover:translate-y-0 cursor-pointer transition-all duration-200 flex items-center justify-center gap-2"
                >
                  {loading ? <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : "Reset Password"}
                </button>
              </motion.div>
            </form>

            <motion.p className="text-center text-[12px] text-gray-400 mt-6" variants={fadeUp}>
              <a href="/" className="inline-flex items-center gap-1.5 text-[#f59e0b] hover:text-orange-600 font-semibold transition-colors">
                <ArrowLeft className="w-3.5 h-3.5" />Back to login
              </a>
            </motion.p>
          </motion.div>
        </div>

        <motion.div className="px-8 pb-5 lg:px-14" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}>
          <p className="text-[10px] text-slate-300/60 dark:text-slate-700 text-center">Developed by Aldridge</p>
        </motion.div>
      </div>

      {/* ═══ RIGHT: Brand Canvas ═══ */}
      <RightPanel />
    </div>
  );
}

function RightPanel() {
  return (
    <div className="hidden lg:flex relative overflow-hidden bg-gradient-to-br from-slate-950 via-[#0f172a] to-black">
      <div className="absolute inset-0">
        <div className="absolute top-[-12%] right-[-8%] w-[700px] h-[700px] rounded-full" style={{ background: "radial-gradient(circle, rgba(245,158,11,0.14), transparent 60%)" }} />
        <div className="absolute bottom-[-18%] left-[-12%] w-[800px] h-[800px] rounded-full" style={{ background: "radial-gradient(circle, rgba(249,115,22,0.07), transparent 55%)" }} />
      </div>
      <div className="absolute inset-0 opacity-[0.025]" style={{ backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.5) 1px, transparent 1px)", backgroundSize: "40px 40px" }} />
      <div className="absolute inset-0 z-[1]">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.5 }}
          className="absolute top-[14%] left-[10%] backdrop-blur-xl bg-white/[0.04] border border-white/[0.06] rounded-xl px-4 py-2.5 shadow-xl flex items-center gap-2.5"
        >
          <Shield className="w-3.5 h-3.5 text-emerald-400/70" />
          <span className="text-[10px] font-bold text-white/40 uppercase tracking-[0.08em]">Enterprise Secured</span>
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        </motion.div>
      </div>
      <div className="relative z-10 flex flex-col justify-end w-full h-full p-12 xl:p-16">
        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.5 }}>
          <h2 className="text-[34px] xl:text-[40px] font-extrabold text-white leading-[1.1] tracking-[-0.03em] max-w-[480px]">
            Secure account<br />recovery.
          </h2>
          <p className="text-[14px] text-white/35 mt-5 max-w-[420px] leading-relaxed">
            Reset your credentials safely with enterprise-grade encryption.
          </p>
        </motion.div>
      </div>
    </div>
  );
}
