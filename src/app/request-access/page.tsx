"use client";

import { useState } from "react";
import { User, Mail, Phone, Building2, MessageSquare, CheckCircle, AlertCircle, ArrowLeft } from "lucide-react";

export default function RequestAccessPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const isValid = name.trim() && email.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const inputClass = "w-full h-11 px-3 rounded-xl bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] text-[13px] text-gray-800 dark:text-gray-200 placeholder:text-gray-400 dark:placeholder:text-gray-600 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 dark:focus:ring-orange-500/10 transition-all";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid || loading) return;
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/team/request-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          phone: phone.trim().replace(/[^0-9+\s]/g, "") || null,
          company: company.trim() || null,
          reason: reason.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Request failed"); setLoading(false); return; }
      setSuccess(true);
    } catch {
      setError("Network error. Please try again.");
    }
    setLoading(false);
  };

  if (success) {
    return (
      <div className="min-h-screen bg-[#f8f9fb] dark:bg-[#09090b] flex items-center justify-center p-4">
        <div className="w-full max-w-[440px] text-center space-y-5">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center">
            <CheckCircle className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
          </div>
          <h1 className="text-[22px] font-bold text-gray-900 dark:text-white tracking-tight">Request Submitted</h1>
          <p className="text-[14px] text-gray-500 dark:text-gray-400 leading-relaxed">
            Your access request has been sent to the team admin. You&apos;ll receive an email once your account is approved.
          </p>
          <a href="/" className="inline-flex items-center gap-2 text-[13px] text-orange-500 hover:text-orange-600 font-semibold transition-colors">
            <ArrowLeft className="w-4 h-4" />Back to login
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8f9fb] dark:bg-[#09090b] flex items-center justify-center p-4">
      <div className="w-full max-w-[480px]">
        <div className="bg-white dark:bg-[#131316] rounded-2xl border border-gray-200/80 dark:border-white/[0.06] shadow-[0_1px_3px_rgba(0,0,0,0.04),0_6px_24px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.2),0_6px_24px_rgba(0,0,0,0.15)] overflow-hidden">

          {/* Header */}
          <div className="bg-gradient-to-r from-gray-900 to-gray-800 dark:from-[#1a1a1e] dark:to-[#131316] px-7 py-6">
            <div className="flex items-center gap-4">
              <img src="/ten80ten-logo.png" alt="Ten80Ten" className="w-10 h-10 rounded-xl object-contain" />
              <div>
                <h1 className="text-[18px] font-bold text-white tracking-tight">Request Access</h1>
                <p className="text-[12px] text-white/50 mt-0.5">Tell us about yourself and why you need access</p>
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {error && (
              <div className="flex items-center gap-2 bg-red-50 dark:bg-red-500/5 border border-red-200 dark:border-red-500/20 rounded-xl p-3">
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                <p className="text-[11px] text-red-700 dark:text-red-400">{error}</p>
              </div>
            )}

            {/* Name */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em]">Full Name <span className="text-red-400">*</span></label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300 dark:text-gray-600" />
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your full name" className={`${inputClass} pl-10`} autoFocus />
              </div>
            </div>

            {/* Email */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em]">Email Address <span className="text-red-400">*</span></label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300 dark:text-gray-600" />
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" className={`${inputClass} pl-10`} />
              </div>
            </div>

            {/* WhatsApp */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em]">WhatsApp Number</label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300 dark:text-gray-600" />
                <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 234 567 8900" className={`${inputClass} pl-10 font-mono`} />
              </div>
            </div>

            {/* Company */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em]">Company / Department</label>
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300 dark:text-gray-600" />
                <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Your company or team" className={`${inputClass} pl-10`} />
              </div>
            </div>

            {/* Reason */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em]">Why do you need access?</label>
              <div className="relative">
                <MessageSquare className="absolute left-3 top-3 w-4 h-4 text-gray-300 dark:text-gray-600" />
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Brief description of your role and what you'll be working on..." rows={3}
                  className={`${inputClass} h-auto min-h-[80px] pl-10 py-2.5 resize-none`} />
              </div>
            </div>

            <button type="submit" disabled={!isValid || loading} className="w-full h-11 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-[13px] font-bold shadow-lg shadow-orange-500/20 disabled:opacity-40 transition-all cursor-pointer flex items-center justify-center gap-2">
              {loading ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Submitting...</> : "Submit Request"}
            </button>

            <p className="text-center text-[12px] text-gray-400">
              Already have an account? <a href="/" className="text-orange-500 hover:text-orange-600 font-semibold transition-colors">Sign in</a>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
