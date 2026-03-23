"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { Mail, Lock, ArrowRight, AlertCircle, Sparkles, Eye, EyeOff } from "lucide-react";

export function LoginScreen() {
  const { login, loginDemo } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(false);
    setIsLoading(true);
    await new Promise((r) => setTimeout(r, 400));
    const success = login(email, password);
    if (!success) { setError(true); setIsLoading(false); }
  };

  const handleDemo = async () => {
    setIsLoading(true);
    await new Promise((r) => setTimeout(r, 300));
    loginDemo();
  };

  return (
    <div className="min-h-screen w-full lg:grid lg:grid-cols-[45fr_55fr]">

      {/* ─── Left: Auth Form ─── */}
      <div className="relative flex flex-col min-h-screen lg:min-h-0 bg-white dark:bg-[#09090b]">
        {/* Logo — pinned top-left */}
        <div className="px-8 pt-8 lg:px-12 lg:pt-10">
          <img src="/ten80ten-logo.png" alt="Ten80Ten" className="w-[140px] h-auto object-contain" />
        </div>

        {/* Form — centered vertically */}
        <div className="flex-1 flex items-center justify-center px-8 lg:px-12 xl:px-20">
          <div className="w-full max-w-[360px]">
            <div className="mb-8">
              <h1 className="text-[26px] font-extrabold text-gray-900 dark:text-white tracking-[-0.02em] leading-tight">
                Welcome back
              </h1>
              <p className="text-[14px] text-gray-400 dark:text-gray-500 mt-2">
                Sign in to your content pipeline
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-[0.1em]">Email</label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300 dark:text-gray-600" />
                  <input
                    type="email"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); setError(false); }}
                    className="w-full h-12 pl-11 pr-4 rounded-lg bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] text-[14px] text-gray-900 dark:text-gray-100 placeholder:text-gray-300 dark:placeholder:text-gray-600 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 dark:focus:ring-orange-500/10 transition-all"
                    autoFocus
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-[0.1em]">Password</label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300 dark:text-gray-600" />
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setError(false); }}
                    className="w-full h-12 pl-11 pr-11 rounded-lg bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] text-[14px] text-gray-900 dark:text-gray-100 placeholder:text-gray-300 dark:placeholder:text-gray-600 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 dark:focus:ring-orange-500/10 transition-all"
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-300 dark:text-gray-600 hover:text-gray-500 cursor-pointer transition-colors">
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-2 bg-red-50 dark:bg-red-500/5 border border-red-200 dark:border-red-500/20 rounded-lg px-3.5 py-2.5">
                  <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                  <span className="text-[12px] text-red-600 dark:text-red-400">Invalid credentials. Please try again.</span>
                </div>
              )}

              <button
                type="submit"
                disabled={!email.trim() || !password.trim() || isLoading}
                className="w-full h-12 rounded-lg bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white text-[14px] font-semibold disabled:opacity-40 cursor-pointer transition-all flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>Sign In<ArrowRight className="w-4 h-4" /></>
                )}
              </button>
            </form>

            {/* Divider */}
            <div className="flex items-center gap-4 my-6">
              <div className="flex-1 h-px bg-gray-100 dark:bg-white/[0.06]" />
              <span className="text-[10px] text-gray-300 dark:text-gray-600 uppercase tracking-[0.15em] font-medium">or</span>
              <div className="flex-1 h-px bg-gray-100 dark:bg-white/[0.06]" />
            </div>

            {/* Demo mode */}
            <button
              type="button"
              onClick={handleDemo}
              disabled={isLoading}
              className="w-full h-12 rounded-lg border border-gray-200 dark:border-white/[0.08] bg-transparent hover:bg-gray-50 dark:hover:bg-white/[0.03] text-gray-600 dark:text-gray-400 text-[13px] font-medium cursor-pointer transition-all flex items-center justify-center gap-2"
            >
              <Sparkles className="w-4 h-4 text-orange-500" />
              Explore Demo Mode
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="px-8 pb-6 lg:px-12">
          <p className="text-[11px] text-gray-300 dark:text-gray-700">&copy; 2026 Ten80Ten Media. All rights reserved.</p>
        </div>
      </div>

      {/* ─── Right: Video Showcase (hidden on mobile) ─── */}
      <div className="hidden lg:flex relative overflow-hidden">
        {/* Video background */}
        <video
          autoPlay muted loop playsInline
          className="absolute inset-0 w-full h-full object-cover"
          src="https://videos.pexels.com/video-files/3129671/3129671-uhd_2560_1440_30fps.mp4"
        />

        {/* Dark overlay */}
        <div className="absolute inset-0 bg-black/60" />

        {/* Gradient overlay — warm tint from bottom */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/30" />

        {/* Content */}
        <div className="relative z-10 flex flex-col justify-between w-full h-full p-12 xl:p-16">
          {/* Top spacer */}
          <div />

          {/* Bottom — copy */}
          <div>
            <h2 className="text-[32px] xl:text-[38px] font-extrabold text-white leading-[1.15] tracking-[-0.02em] max-w-[440px]">
              Your entire content workflow, one&nbsp;dashboard.
            </h2>
            <p className="text-[14px] text-white/50 mt-4 max-w-[380px] leading-relaxed">
              Plan, approve, schedule, and publish — all from a single pipeline built for teams that move fast.
            </p>

            <div className="flex items-center gap-8 mt-8">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-orange-500" />
                <span className="text-[12px] text-white/40 font-medium">Pipeline</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-500" />
                <span className="text-[12px] text-white/40 font-medium">Approvals</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-sky-500" />
                <span className="text-[12px] text-white/40 font-medium">Scheduling</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
