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

      {/* ─── Right: Brand Showcase (hidden on mobile) ─── */}
      <div className="hidden lg:flex relative overflow-hidden bg-[#0a0a0f]">
        {/* Gradient mesh — orange glow */}
        <div className="absolute inset-0">
          <div className="absolute top-[-20%] right-[-10%] w-[600px] h-[600px] rounded-full opacity-[0.07]" style={{ background: "radial-gradient(circle, #ea580c, transparent 70%)" }} />
          <div className="absolute bottom-[-15%] left-[-5%] w-[500px] h-[500px] rounded-full opacity-[0.04]" style={{ background: "radial-gradient(circle, #f97316, transparent 70%)" }} />
          <div className="absolute top-[40%] left-[30%] w-[400px] h-[400px] rounded-full opacity-[0.03]" style={{ background: "radial-gradient(circle, #3b82f6, transparent 70%)" }} />
        </div>

        {/* Subtle grid pattern */}
        <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.4) 1px, transparent 1px)", backgroundSize: "32px 32px" }} />

        {/* Content */}
        <div className="relative z-10 flex flex-col items-center justify-center w-full px-16 xl:px-24">
          {/* Brand mark */}
          <div className="mb-10">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center shadow-lg shadow-orange-500/20">
              <span className="text-[24px] font-black text-white tracking-tighter">T</span>
            </div>
          </div>

          {/* Headline */}
          <h2 className="text-[36px] xl:text-[42px] font-extrabold text-white text-center leading-[1.1] tracking-[-0.03em] max-w-[480px]">
            The Command Center for Elite Content Pipelines
          </h2>

          <p className="text-[15px] text-gray-500 text-center mt-5 max-w-[380px] leading-relaxed">
            Streamline approvals, manage assets, and ship content at scale across every platform.
          </p>

          {/* Stats row */}
          <div className="flex items-center gap-10 mt-12">
            {[
              { value: "5+", label: "Platforms" },
              { value: "10x", label: "Faster" },
              { value: "100%", label: "Organized" },
            ].map((stat) => (
              <div key={stat.label} className="text-center">
                <p className="text-[28px] font-black text-white tracking-tight">{stat.value}</p>
                <p className="text-[11px] text-gray-600 uppercase tracking-[0.12em] font-medium mt-0.5">{stat.label}</p>
              </div>
            ))}
          </div>

          {/* Subtle divider line */}
          <div className="w-12 h-px bg-gray-800 mt-12 mb-8" />

          {/* Testimonial-style text */}
          <p className="text-[13px] text-gray-600 italic text-center max-w-[340px]">
            &ldquo;From idea to posted in one drag. The pipeline changed how we operate.&rdquo;
          </p>
          <p className="text-[11px] text-gray-700 mt-2 font-medium">Ten80Ten Creative Team</p>
        </div>
      </div>
    </div>
  );
}
