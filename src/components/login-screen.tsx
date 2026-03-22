"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Mail, Lock, ArrowRight, AlertCircle, Sparkles } from "lucide-react";

export function LoginScreen() {
  const { login, loginDemo } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
    <div className="relative min-h-screen flex items-center justify-center bg-[#f8f9fb]">
      {/* Subtle bg */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] opacity-30 pointer-events-none" style={{ background: "radial-gradient(ellipse, #dbeafe, transparent 70%)" }} />

      <div className="relative z-10 w-full max-w-[380px] mx-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
        <div className="bg-white rounded-2xl p-8 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_8px_32px_rgba(0,0,0,0.06)] border border-gray-100">
          {/* Logo */}
          <div className="flex justify-center mb-6">
            <img src="/ten80ten-logo.png" alt="Ten80Ten" className="w-[180px] h-auto object-contain" />
          </div>

          <div className="text-center mb-6">
            <h1 className="text-[15px] font-semibold text-gray-900 tracking-[-0.01em]">Content Pipeline</h1>
            <p className="text-[13px] text-gray-400 mt-1">Sign in to manage your content</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-[14px] h-[14px] text-gray-300" />
              <Input type="email" placeholder="Email address" value={email} onChange={(e) => { setEmail(e.target.value); setError(false); }} className="h-10 pl-9 pr-3 bg-gray-50/80 border-gray-200 rounded-lg text-[13px] text-gray-900 placeholder:text-gray-300 focus:border-blue-400 focus:ring-blue-100" autoFocus />
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-[14px] h-[14px] text-gray-300" />
              <Input type="password" placeholder="Password" value={password} onChange={(e) => { setPassword(e.target.value); setError(false); }} className="h-10 pl-9 pr-3 bg-gray-50/80 border-gray-200 rounded-lg text-[13px] text-gray-900 placeholder:text-gray-300 focus:border-blue-400 focus:ring-blue-100" />
            </div>

            {error && (
              <div className="flex items-center gap-1.5 text-red-500 text-[12px] px-0.5 animate-in fade-in duration-150">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>Invalid credentials. Please try again.</span>
              </div>
            )}

            <Button type="submit" disabled={!email.trim() || !password.trim() || isLoading} className="w-full h-10 rounded-lg bg-gray-900 hover:bg-gray-800 text-white text-[13px] font-medium shadow-sm disabled:opacity-40 cursor-pointer">
              {isLoading ? (
                <div className="w-4 h-4 border-2 border-gray-600 border-t-white rounded-full animate-spin" />
              ) : (
                <span className="flex items-center gap-1.5">Sign In<ArrowRight className="w-3.5 h-3.5" /></span>
              )}
            </Button>
          </form>

          <div className="flex items-center gap-3 my-4">
            <div className="flex-1 h-px bg-gray-100" />
            <span className="text-[11px] text-gray-300 uppercase tracking-wider">or</span>
            <div className="flex-1 h-px bg-gray-100" />
          </div>

          <Button type="button" onClick={handleDemo} disabled={isLoading} className="w-full h-10 rounded-lg bg-blue-50 border border-blue-100 text-blue-600 hover:bg-blue-100 text-[13px] font-medium cursor-pointer">
            <Sparkles className="w-3.5 h-3.5 mr-1.5" />
            Try Demo Mode
          </Button>
        </div>

        <p className="text-center text-gray-300 text-[11px] mt-5">
          Ten80Ten Social Media Management Platform &copy; 2026
        </p>
      </div>
    </div>
  );
}
