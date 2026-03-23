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
        {/* Form — centered as cohesive group */}
        <div className="flex-1 flex items-center justify-center px-8 lg:px-14 xl:px-20">
          <div className="w-full max-w-[360px]">
            {/* Logo + heading as one block */}
            <div className="mb-10">
              <img src="/ten80ten-logo.png" alt="Ten80Ten" className="w-[130px] h-auto object-contain mb-8" />
              <h1 className="text-[28px] font-extrabold text-gray-900 dark:text-white tracking-[-0.03em] leading-[1.1]">
                Welcome back
              </h1>
              <p className="text-[14px] text-gray-400 dark:text-gray-500 mt-2.5">
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
                    className="w-full h-12 pl-11 pr-4 rounded-xl bg-slate-50 dark:bg-white/[0.04] border border-gray-200/80 dark:border-white/[0.08] text-[14px] text-gray-900 dark:text-gray-100 placeholder:text-gray-300 dark:placeholder:text-gray-600 outline-none focus:bg-white dark:focus:bg-white/[0.06] focus:border-orange-400 focus:ring-2 focus:ring-orange-100 dark:focus:ring-orange-500/10 transition-all"
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
                    className="w-full h-12 pl-11 pr-11 rounded-xl bg-slate-50 dark:bg-white/[0.04] border border-gray-200/80 dark:border-white/[0.08] text-[14px] text-gray-900 dark:text-gray-100 placeholder:text-gray-300 dark:placeholder:text-gray-600 outline-none focus:bg-white dark:focus:bg-white/[0.06] focus:border-orange-400 focus:ring-2 focus:ring-orange-100 dark:focus:ring-orange-500/10 transition-all"
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-300 dark:text-gray-600 hover:text-gray-500 cursor-pointer transition-colors">
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-2 bg-red-50 dark:bg-red-500/5 border border-red-200 dark:border-red-500/20 rounded-xl px-3.5 py-2.5">
                  <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                  <span className="text-[12px] text-red-600 dark:text-red-400">Invalid credentials. Please try again.</span>
                </div>
              )}

              <button
                type="submit"
                disabled={!email.trim() || !password.trim() || isLoading}
                className="w-full h-12 rounded-xl bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white text-[14px] font-bold shadow-lg shadow-orange-500/25 hover:shadow-orange-600/30 disabled:opacity-40 disabled:shadow-none cursor-pointer transition-all duration-200 flex items-center justify-center gap-2"
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
              className="w-full h-11 rounded-xl border border-gray-200 dark:border-white/[0.08] bg-transparent hover:bg-slate-50 dark:hover:bg-white/[0.03] text-gray-500 dark:text-gray-400 text-[13px] font-medium cursor-pointer transition-all flex items-center justify-center gap-2"
            >
              <Sparkles className="w-4 h-4 text-orange-400" />
              Explore Demo Mode
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="px-8 pb-6 lg:px-14">
          <p className="text-[11px] text-gray-300 dark:text-gray-700">&copy; 2026 Ten80Ten Media. All rights reserved.</p>
        </div>
      </div>

      {/* ─── Right: Premium Brand Canvas (hidden on mobile) ─── */}
      <div className="hidden lg:flex relative overflow-hidden bg-[#0a0a0e]">
        {/* Gradient mesh — layered radials for depth */}
        <div className="absolute inset-0">
          {/* Primary orange glow — top right */}
          <div className="absolute top-[-15%] right-[-10%] w-[700px] h-[700px] rounded-full" style={{ background: "radial-gradient(circle, rgba(234,88,12,0.15), transparent 65%)" }} />
          {/* Secondary warm glow — bottom left */}
          <div className="absolute bottom-[-20%] left-[-15%] w-[800px] h-[800px] rounded-full" style={{ background: "radial-gradient(circle, rgba(249,115,22,0.08), transparent 60%)" }} />
          {/* Cool accent — center */}
          <div className="absolute top-[35%] left-[40%] w-[500px] h-[500px] rounded-full" style={{ background: "radial-gradient(circle, rgba(59,130,246,0.04), transparent 60%)" }} />
          {/* Deep warm — bottom right corner */}
          <div className="absolute bottom-[5%] right-[5%] w-[400px] h-[400px] rounded-full" style={{ background: "radial-gradient(circle, rgba(234,88,12,0.06), transparent 55%)" }} />
        </div>

        {/* Subtle dot grid */}
        <div className="absolute inset-0 opacity-[0.025]" style={{ backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.5) 1px, transparent 1px)", backgroundSize: "40px 40px" }} />

        {/* Faint pipeline wireframe */}
        <div className="absolute top-[12%] right-[8%] opacity-[0.04]">
          <svg width="340" height="480" viewBox="0 0 340 480" fill="none">
            <rect x="0" y="0" width="100" height="440" rx="12" stroke="white" strokeWidth="1" />
            <rect x="120" y="30" width="100" height="440" rx="12" stroke="white" strokeWidth="1" />
            <rect x="240" y="15" width="100" height="440" rx="12" stroke="white" strokeWidth="1" />
            <rect x="8" y="16" width="84" height="56" rx="8" stroke="white" strokeWidth="0.5" />
            <rect x="8" y="82" width="84" height="56" rx="8" stroke="white" strokeWidth="0.5" />
            <rect x="8" y="148" width="84" height="56" rx="8" stroke="white" strokeWidth="0.5" />
            <rect x="128" y="46" width="84" height="56" rx="8" stroke="white" strokeWidth="0.5" />
            <rect x="128" y="112" width="84" height="56" rx="8" stroke="white" strokeWidth="0.5" />
            <rect x="248" y="31" width="84" height="56" rx="8" stroke="white" strokeWidth="0.5" />
            <rect x="248" y="97" width="84" height="56" rx="8" stroke="white" strokeWidth="0.5" />
            <rect x="248" y="163" width="84" height="56" rx="8" stroke="white" strokeWidth="0.5" />
            <rect x="248" y="229" width="84" height="56" rx="8" stroke="white" strokeWidth="0.5" />
          </svg>
        </div>

        {/* Content */}
        <div className="relative z-10 flex flex-col justify-end w-full h-full p-12 xl:p-16">
          <div>
            <h2 className="text-[34px] xl:text-[40px] font-extrabold text-white leading-[1.12] tracking-[-0.03em] max-w-[460px]">
              Your entire content workflow, one&nbsp;dashboard.
            </h2>
            <p className="text-[14px] text-white/40 mt-5 max-w-[400px] leading-relaxed">
              Plan, approve, schedule, and publish — all from a single pipeline built for teams that move fast.
            </p>

            <div className="flex items-center gap-8 mt-10 pb-2">
              {[
                { label: "Pipeline", color: "bg-orange-500" },
                { label: "Approvals", color: "bg-emerald-500" },
                { label: "Scheduling", color: "bg-sky-500" },
                { label: "Publishing", color: "bg-violet-500" },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-2.5">
                  <div className={`w-2 h-2 rounded-full ${item.color}`} />
                  <span className="text-[12px] text-white/35 font-medium tracking-wide">{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
