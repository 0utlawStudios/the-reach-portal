"use client";

import { RawImage } from "@/components/raw-image";
import { useState } from "react";
import Link from "next/link";
import { Mail, ArrowLeft, CheckCircle, AlertCircle, KeyRound } from "lucide-react";
import { motion } from "framer-motion";

const ease = [0.25, 0.4, 0.25, 1] as const;
const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.07, delayChildren: 0.1 } } };
const fadeUp = { hidden: { opacity: 0, y: 18 }, show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: ease as unknown as [number, number, number, number] } } };

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid || loading) return;
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const data = await res.json();
      if (data.success) {
        setSent(true);
      } else {
        setError(data.error || "Something went wrong");
      }
    } catch {
      setError("Network error. Please try again.");
    }
    setLoading(false);
  };

  if (sent) {
    return (
      <div className="min-h-dvh w-full lg:grid lg:grid-cols-[45fr_55fr]">
        <div className="relative flex flex-col min-h-dvh lg:min-h-0 bg-white dark:bg-[#09090b]">
          <div className="flex-1 flex items-center justify-center px-8 lg:px-14 xl:px-20">
            <div className="w-full max-w-[360px] text-center space-y-5">
              <div className="w-16 h-16 mx-auto rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center">
                <CheckCircle className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
              </div>
              <h1 className="text-[24px] font-extrabold text-gray-900 dark:text-white tracking-[-0.03em]">Check your email</h1>
              <p className="text-[14px] text-gray-500 dark:text-gray-400 leading-relaxed">
                If an account exists for <strong className="text-gray-700 dark:text-gray-300">{email}</strong>, we&apos;ve sent a password reset link.
              </p>
              <Link href="/" className="inline-flex items-center gap-2 text-[13px] text-[#975428] hover:text-[#6C655A] font-semibold transition-colors">
                <ArrowLeft className="w-4 h-4" />Back to login
              </Link>
            </div>
          </div>
        </div>
        <RightPanel />
      </div>
    );
  }

  return (
    <div className="min-h-dvh w-full lg:grid lg:grid-cols-[45fr_55fr]">
      {/* ═══ LEFT: Form ═══ */}
      <div className="relative flex flex-col min-h-dvh lg:min-h-0 bg-white dark:bg-[#09090b]">
        <div className="flex-1 flex items-center justify-center px-8 lg:px-14 xl:px-20">
          <motion.div className="w-full max-w-[360px]" variants={stagger} initial="hidden" animate="show">
            {/* Logo + heading */}
            <motion.div className="mb-10" variants={fadeUp}>
              <RawImage src="/the-reach-logo.png" alt="The Reach" className="w-[130px] h-auto object-contain mb-8" />
              <h1 className="text-[28px] font-extrabold text-gray-900 dark:text-white tracking-[-0.03em] leading-[1.1]">
                Forgot password?
              </h1>
              <p className="text-[14px] text-gray-400 dark:text-gray-500 mt-2.5">
                Enter your email and we&apos;ll send you a reset link
              </p>
            </motion.div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Email */}
              <motion.div className="space-y-1.5" variants={fadeUp}>
                <label className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-[0.1em]">Email</label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300 dark:text-gray-600" />
                  <input
                    type="email"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); setError(""); }}
                    autoComplete="email"
                    className="w-full h-[52px] pl-11 pr-4 rounded-xl bg-[#f7f5ef] dark:bg-white/[0.04] border border-gray-200/70 dark:border-white/[0.08] text-[14px] text-gray-900 dark:text-gray-100 placeholder:text-gray-300 dark:placeholder:text-gray-600 outline-none focus:bg-white dark:focus:bg-white/[0.06] focus:border-[#975428] focus:ring-2 focus:ring-[#975428]/15 transition-all"
                    autoFocus
                  />
                </div>
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
                  className="w-full h-[52px] rounded-xl bg-[#975428] hover:bg-[#7f4421] active:bg-[#6f3b1d] hover:-translate-y-0.5 text-white text-[14px] font-bold shadow-lg shadow-[#975428]/25 hover:shadow-xl hover:shadow-[#975428]/30 disabled:opacity-40 disabled:shadow-none disabled:hover:translate-y-0 cursor-pointer transition-all duration-200 flex items-center justify-center gap-2"
                >
                  {loading ? <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : "Send Reset Link"}
                </button>
              </motion.div>
            </form>

            <motion.p className="text-center text-[12px] text-gray-400 mt-6" variants={fadeUp}>
              Remember your password?{" "}
              <Link href="/" className="text-[#975428] hover:text-[#6C655A] font-semibold transition-colors">Sign in</Link>
            </motion.p>
          </motion.div>
        </div>

        <motion.div className="px-8 pb-5 lg:px-14" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}>
          <p className="text-[10px] text-[#6C655A]/35 dark:text-[#E1DFD5]/25 text-center">Developed by Aldridge</p>
        </motion.div>
      </div>

      {/* ═══ RIGHT: Brand Canvas ═══ */}
      <RightPanel />
    </div>
  );
}

function RightPanel() {
  return (
    <div className="hidden lg:flex relative overflow-hidden bg-gradient-to-br from-[#6C655A] via-[#5A656C] to-[#2f302d]">
      {/* Gradient Mesh */}
      <div className="absolute inset-0">
        <div className="absolute top-[-12%] right-[-8%] w-[700px] h-[700px] rounded-full" style={{ background: "radial-gradient(circle, rgba(151,84,40,0.14), transparent 60%)" }} />
        <div className="absolute bottom-[-18%] left-[-12%] w-[800px] h-[800px] rounded-full" style={{ background: "radial-gradient(circle, rgba(225,223,213,0.07), transparent 55%)" }} />
        <div className="absolute top-[40%] left-[45%] w-[500px] h-[500px] rounded-full" style={{ background: "radial-gradient(circle, rgba(90,101,108,0.10), transparent 55%)" }} />
      </div>

      {/* Dot grid */}
      <div className="absolute inset-0 opacity-[0.025]" style={{ backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.5) 1px, transparent 1px)", backgroundSize: "40px 40px" }} />

      {/* Glassmorphic cards */}
      <div className="absolute inset-0 z-[1]">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4, ease: [0.25, 0.4, 0.25, 1] }}
          className="absolute top-[18%] right-[10%] backdrop-blur-xl bg-white/[0.06] border border-white/[0.08] rounded-2xl p-5 shadow-2xl"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#975428]/15 flex items-center justify-center">
              <KeyRound className="w-5 h-5 text-[#975428]" />
            </div>
            <div>
              <p className="text-[11px] text-white/50 font-medium">Password Security</p>
              <p className="text-[10px] text-emerald-400 font-bold mt-0.5">AES-256 Encrypted</p>
            </div>
          </div>
        </motion.div>

      </div>

      {/* Bottom typography */}
      <div className="relative z-10 flex flex-col justify-end w-full h-full p-12 xl:p-16">
        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.5, ease: [0.25, 0.4, 0.25, 1] }}>
          <h2 className="text-[34px] xl:text-[40px] font-extrabold text-white leading-[1.1] tracking-[-0.03em] max-w-[480px]">
            Secure account<br />recovery.
          </h2>
          <p className="text-[14px] text-white/35 mt-5 max-w-[420px] leading-relaxed">
            Reset your password and get back to work.
          </p>
        </motion.div>
      </div>
    </div>
  );
}
