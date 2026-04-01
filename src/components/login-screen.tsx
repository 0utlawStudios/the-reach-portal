"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { Mail, Lock, ArrowRight, AlertCircle, Eye, EyeOff, Zap, Shield, BarChart3, Send } from "lucide-react";
import { motion } from "framer-motion";

const ease = [0.25, 0.4, 0.25, 1] as const;
const fadeUp = (delay: number) => ({
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.5, delay, ease: ease as unknown as [number, number, number, number] } },
});

export function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(false);
    setIsLoading(true);
    const success = await login(email, password);
    if (!success) { setError(true); setIsLoading(false); }
  };

  return (
    <div className="min-h-screen w-full lg:grid lg:grid-cols-[45fr_55fr]">

      {/* ═══════════════════════════════════════════════
          LEFT: Authentication Panel
          ═══════════════════════════════════════════════ */}
      <div className="relative flex flex-col min-h-screen lg:min-h-0 bg-white dark:bg-[#09090b]">

        {/* Form — vertically centered cohesive group */}
        <div className="flex-1 flex items-center justify-center px-8 lg:px-14 xl:px-20">
          <div className="w-full max-w-[360px]">

            {/* Logo + heading */}
            <motion.div className="mb-10" {...fadeUp(0)}>
              <img src="/ten80ten-logo.png" alt="Ten80Ten" className="w-[130px] h-auto object-contain mb-8" />
              <h1 className="text-[28px] font-extrabold text-gray-900 dark:text-white tracking-[-0.03em] leading-[1.1]">
                Welcome back
              </h1>
              <p className="text-[14px] text-gray-400 dark:text-gray-500 mt-2.5">
                Sign in to your content pipeline
              </p>
            </motion.div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Email */}
              <motion.div className="space-y-1.5" {...fadeUp(0.08)}>
                <label className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-[0.1em]">Email</label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300 dark:text-gray-600" />
                  <input
                    type="email"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); setError(false); }}
                    className="w-full h-12 pl-11 pr-4 rounded-xl bg-slate-50 dark:bg-white/[0.04] border border-gray-200/80 dark:border-white/[0.08] text-[14px] text-gray-900 dark:text-gray-100 placeholder:text-gray-300 dark:placeholder:text-gray-600 outline-none focus:bg-white dark:focus:bg-white/[0.06] focus:border-[#f59e0b] focus:ring-2 focus:ring-[#f59e0b]/20 transition-all"
                    autoFocus
                  />
                </div>
              </motion.div>

              {/* Password */}
              <motion.div className="space-y-1.5" {...fadeUp(0.14)}>
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-[0.1em]">Password</label>
                  <a href="/auth/forgot-password" className="text-[10px] font-semibold text-[#f59e0b] hover:text-orange-600 transition-colors">Forgot password?</a>
                </div>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300 dark:text-gray-600" />
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setError(false); }}
                    className="w-full h-12 pl-11 pr-11 rounded-xl bg-slate-50 dark:bg-white/[0.04] border border-gray-200/80 dark:border-white/[0.08] text-[14px] text-gray-900 dark:text-gray-100 placeholder:text-gray-300 dark:placeholder:text-gray-600 outline-none focus:bg-white dark:focus:bg-white/[0.06] focus:border-[#f59e0b] focus:ring-2 focus:ring-[#f59e0b]/20 transition-all"
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-300 dark:text-gray-600 hover:text-gray-500 cursor-pointer transition-colors">
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </motion.div>

              {/* Error */}
              {error && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex items-center gap-2 bg-red-50 dark:bg-red-500/5 border border-red-200 dark:border-red-500/20 rounded-xl px-3.5 py-2.5"
                >
                  <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                  <span className="text-[12px] text-red-600 dark:text-red-400">Invalid credentials. Please try again.</span>
                </motion.div>
              )}

              {/* Sign In Button */}
              <motion.div {...fadeUp(0.2)}>
                <button
                  type="submit"
                  disabled={!email.trim() || !password.trim() || isLoading}
                  className="w-full h-12 rounded-xl bg-[#f59e0b] hover:bg-orange-500 active:bg-orange-600 hover:-translate-y-0.5 text-white text-[14px] font-bold shadow-lg shadow-[#f59e0b]/25 hover:shadow-xl hover:shadow-[#f59e0b]/30 disabled:opacity-40 disabled:shadow-none disabled:hover:translate-y-0 cursor-pointer transition-all duration-200 flex items-center justify-center gap-2"
                >
                  {isLoading ? (
                    <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>Sign In<ArrowRight className="w-4 h-4" /></>
                  )}
                </button>
              </motion.div>
            </form>

            {/* Request Access */}
            <motion.p className="text-center text-[12px] text-gray-400 mt-6" {...fadeUp(0.26)}>
              Don&apos;t have an account?{" "}
              <a href="/request-access" className="text-[#f59e0b] hover:text-orange-600 font-semibold transition-colors">Request Access</a>
            </motion.p>
          </div>
        </div>

        {/* Footer */}
        <motion.div className="px-8 pb-5 lg:px-14" {...fadeUp(0.4)}>
          <p className="text-[10px] text-slate-300/60 dark:text-slate-700 text-center">Developed by Aldridge</p>
        </motion.div>
      </div>

      {/* ═══════════════════════════════════════════════
          RIGHT: Brand Canvas (hidden on mobile)
          ═══════════════════════════════════════════════ */}
      <div className="hidden lg:flex relative overflow-hidden bg-gradient-to-br from-slate-950 via-[#0f172a] to-black">

        {/* ── Gradient Mesh ── */}
        <div className="absolute inset-0">
          <div className="absolute top-[-12%] right-[-8%] w-[700px] h-[700px] rounded-full" style={{ background: "radial-gradient(circle, rgba(245,158,11,0.14), transparent 60%)" }} />
          <div className="absolute bottom-[-18%] left-[-12%] w-[800px] h-[800px] rounded-full" style={{ background: "radial-gradient(circle, rgba(249,115,22,0.07), transparent 55%)" }} />
          <div className="absolute top-[40%] left-[45%] w-[500px] h-[500px] rounded-full" style={{ background: "radial-gradient(circle, rgba(59,130,246,0.035), transparent 55%)" }} />
          <div className="absolute bottom-[8%] right-[8%] w-[350px] h-[350px] rounded-full" style={{ background: "radial-gradient(circle, rgba(245,158,11,0.05), transparent 50%)" }} />
        </div>

        {/* ── Dot grid ── */}
        <div className="absolute inset-0 opacity-[0.025]" style={{ backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.5) 1px, transparent 1px)", backgroundSize: "40px 40px" }} />

        {/* ── Glassmorphic analytics cards (floating) ── */}
        <div className="absolute inset-0 z-[1]">
          {/* Card 1 — Top right: Engagement metric */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.4, ease: [0.25, 0.4, 0.25, 1] }}
            className="absolute top-[12%] right-[8%] w-[220px] backdrop-blur-xl bg-white/[0.06] border border-white/[0.08] rounded-2xl p-5 shadow-2xl"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-semibold text-white/40 uppercase tracking-[0.1em]">Engagement</span>
              <BarChart3 className="w-3.5 h-3.5 text-[#f59e0b]/60" />
            </div>
            <p className="text-[28px] font-extrabold text-white tracking-[-0.03em]">24.8%</p>
            <div className="flex items-center gap-1.5 mt-1.5">
              <span className="text-[10px] font-bold text-emerald-400">+12.4%</span>
              <span className="text-[10px] text-white/30">vs last week</span>
            </div>
            {/* Mini bar chart */}
            <div className="flex items-end gap-1 mt-4 h-[28px]">
              {[35, 50, 40, 65, 55, 80, 70, 90, 75, 95].map((h, i) => (
                <div key={i} className="flex-1 rounded-sm bg-[#f59e0b]/20" style={{ height: `${h}%` }}>
                  <div className="w-full rounded-sm bg-[#f59e0b]/60" style={{ height: `${Math.min(100, h + 15)}%` }} />
                </div>
              ))}
            </div>
          </motion.div>

          {/* Card 2 — Center left: Pipeline status */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.6, ease: [0.25, 0.4, 0.25, 1] }}
            className="absolute top-[38%] left-[6%] w-[200px] backdrop-blur-xl bg-white/[0.06] border border-white/[0.08] rounded-2xl p-5 shadow-2xl"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-semibold text-white/40 uppercase tracking-[0.1em]">Pipeline</span>
              <Zap className="w-3.5 h-3.5 text-[#f59e0b]/60" />
            </div>
            <div className="space-y-2.5">
              {[
                { label: "Ideas", count: 12, color: "bg-sky-400" },
                { label: "In Review", count: 8, color: "bg-[#f59e0b]" },
                { label: "Approved", count: 5, color: "bg-emerald-400" },
                { label: "Published", count: 31, color: "bg-violet-400" },
              ].map((s) => (
                <div key={s.label} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`w-1.5 h-1.5 rounded-full ${s.color}`} />
                    <span className="text-[11px] text-white/50">{s.label}</span>
                  </div>
                  <span className="text-[12px] font-bold text-white/70 tabular-nums">{s.count}</span>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Card 3 — Bottom center: Quick post */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.8, ease: [0.25, 0.4, 0.25, 1] }}
            className="absolute bottom-[28%] right-[22%] w-[240px] backdrop-blur-xl bg-white/[0.06] border border-white/[0.08] rounded-2xl p-5 shadow-2xl"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-semibold text-white/40 uppercase tracking-[0.1em]">Auto-Post</span>
              <Send className="w-3.5 h-3.5 text-emerald-400/60" />
            </div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#f59e0b]/20 to-orange-500/10 border border-white/[0.06] flex items-center justify-center">
                <img src="/ten80ten-logo.png" alt="" className="w-6 h-6 object-contain" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-white/60 font-medium truncate">Spring Campaign</p>
                <p className="text-[10px] text-emerald-400 font-bold mt-0.5">Scheduled for 2:00 PM</p>
              </div>
            </div>
            <div className="flex gap-1.5 mt-3">
              {["IG", "FB", "TT", "LI"].map((p) => (
                <span key={p} className="px-2 py-0.5 rounded-md bg-white/[0.06] border border-white/[0.04] text-[9px] font-bold text-white/40 tracking-wider">{p}</span>
              ))}
            </div>
          </motion.div>

          {/* Card 4 — Top left: Security badge */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 1.0, ease: [0.25, 0.4, 0.25, 1] }}
            className="absolute top-[14%] left-[10%] backdrop-blur-xl bg-white/[0.04] border border-white/[0.06] rounded-xl px-4 py-2.5 shadow-xl flex items-center gap-2.5"
          >
            <Shield className="w-3.5 h-3.5 text-emerald-400/70" />
            <span className="text-[10px] font-bold text-white/40 uppercase tracking-[0.08em]">Enterprise Secured</span>
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          </motion.div>
        </div>

        {/* ── Bottom typography ── */}
        <div className="relative z-10 flex flex-col justify-end w-full h-full p-12 xl:p-16">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.5, ease: [0.25, 0.4, 0.25, 1] }}
          >
            <h2 className="text-[34px] xl:text-[40px] font-extrabold text-white leading-[1.1] tracking-[-0.03em] max-w-[480px]">
              The ultimate<br />social engine.
            </h2>
            <p className="text-[14px] text-white/35 mt-5 max-w-[420px] leading-relaxed">
              Deploy campaigns, manage approvals, and dominate algorithms from one master dashboard.
            </p>

            <div className="flex items-center gap-8 mt-10 pb-2">
              {[
                { label: "Pipeline", color: "bg-[#f59e0b]" },
                { label: "Approvals", color: "bg-emerald-400" },
                { label: "Scheduling", color: "bg-sky-400" },
                { label: "Publishing", color: "bg-violet-400" },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-2.5">
                  <div className={`w-2 h-2 rounded-full ${item.color}`} />
                  <span className="text-[12px] text-white/30 font-medium tracking-wide">{item.label}</span>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
