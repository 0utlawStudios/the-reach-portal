"use client";

import { RawImage } from "@/components/raw-image";
import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";
import { Lock, CheckCircle, AlertCircle, Eye, EyeOff, User, Phone, Shield, Camera } from "lucide-react";
import { AvatarCropModal } from "@/components/avatar-crop-modal";
import { ToastProvider } from "@/lib/toast-context";
import { ToastContainer } from "@/components/toast-container";

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
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState("");
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("");
  const [ready, setReady] = useState(false);
  const [passwordUpdated, setPasswordUpdated] = useState(false);

  useEffect(() => {
    async function initSession() {
      // Tokens arrive in the URL fragment (#access_token=...). Fragments are
      // never sent to the server or in the Referer header. Read from the hash,
      // not the query string (SEC-001), then scrub the fragment immediately so
      // the credentials do not persist in the address bar or history (SEC-004).
      const hash = window.location.hash.replace(/^#/, "");
      const params = new URLSearchParams(hash);
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");
      if (hash) {
        window.history.replaceState({}, "", window.location.pathname);
      }

      const supabase = getSupabase();

      const hydrateInviteProfile = (email: string, meta: Record<string, unknown>) => {
        setInviteEmail(email || (typeof meta.email === "string" ? meta.email : ""));
        setInviteRole(typeof meta.role === "string" ? meta.role : "");
        const name = typeof meta.name === "string" ? meta.name : "";
        if (name.includes(" ")) {
          setFirstName(name.split(" ")[0]);
          setLastName(name.split(" ").slice(1).join(" "));
        } else {
          setFirstName(name);
        }
      };

      if (accessToken) {
        // Establish a proper Supabase session
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
          hydrateInviteProfile(payload.email || "", payload.user_metadata || {});
        } catch { /* ignore */ }
        return;
      }

      // Recovery path: if the invite link was already consumed but setup was
      // interrupted, Supabase may still have a valid session. Let the user
      // resume activation instead of trapping them behind the pending-access
      // gate with only Refresh / Sign Out.
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        hydrateInviteProfile(session.user.email || "", session.user.user_metadata || {});
        setReady(true);
      }
    }
    initSession();
  }, []);

  const canSubmit = ready && !loading;

  const handleAvatarSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Open the crop modal with the chosen image; the cropped result becomes
    // the avatar. Reset the input so re-selecting the same file re-fires.
    const reader = new FileReader();
    reader.onload = (ev) => setCropImageSrc(ev.target?.result as string);
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleCroppedAvatar = (croppedBlob: Blob) => {
    setAvatarFile(new File([croppedBlob], "avatar.jpg", { type: "image/jpeg" }));
    const reader = new FileReader();
    reader.onload = (ev) => setAvatarPreview(ev.target?.result as string);
    reader.readAsDataURL(croppedBlob);
    setCropImageSrc(null);
  };

  const inputClass = "w-full h-11 px-3 rounded-xl bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] text-[13px] text-gray-800 dark:text-gray-200 placeholder:text-gray-400 dark:placeholder:text-gray-600 outline-none focus:border-[#975428] focus:ring-2 focus:ring-[#975428]/15 dark:focus:ring-[#975428]/15 transition-all";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    if (!avatarFile) {
      setError("Please add a profile photo.");
      return;
    }
    if (!firstName.trim()) {
      setError("First name is required.");
      return;
    }
    if (!lastName.trim()) {
      setError("Last name is required.");
      return;
    }
    if (!whatsapp.trim()) {
      setError("WhatsApp number is required.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    setError("");

    const fullName = `${firstName.trim()} ${lastName.trim()}`;
    const cleanPhone = whatsapp.trim().replace(/[^0-9+]/g, "");
    const supabase = getSupabase();

    // Update password. If a previous activation attempt already changed the
    // password but failed later, Supabase may reject the same password as "not
    // different"; in that retry case, keep going to the server activation step.
    if (!passwordUpdated) {
      const { error: pwError } = await supabase.auth.updateUser({
        password,
        data: { name: fullName, phone: cleanPhone },
      });
      if (pwError) {
        if (!pwError.message.includes("different from the old")) {
          setError(pwError.message);
          setLoading(false);
          return;
        }
      } else {
        setPasswordUpdated(true);
      }
    }

    // Get user/session after password update so the activation API can verify
    // the actor and promote workspace access with the service role.
    const { data: { session } } = await supabase.auth.getSession();
    const { data: { user } } = await supabase.auth.getUser();
    const accessToken = session?.access_token;
    if (!accessToken) {
      setError("Session expired. Please request a new invite link.");
      setLoading(false);
      return;
    }

    // Upload avatar before activation. The page can resume from an existing
    // session, so upload failure no longer strands the user; they can retry
    // setup with the same consumed invite session.
    let avatarUrl: string | null = null;
    if (avatarFile && user?.email) {
      const ext = avatarFile.name.split(".").pop() || "jpg";
      const path = `${user.email.replace(/[^a-z0-9]/gi, "_")}-${Date.now()}.${ext}`;
      const { error: uploadErr } = await supabase.storage.from("avatars").upload(path, avatarFile, { upsert: true, cacheControl: "31536000" });
      if (uploadErr) {
        setError("Failed to upload photo. Please try again.");
        setLoading(false);
        return;
      }
      const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path);
      avatarUrl = urlData.publicUrl;
    }

    const activation = await fetch("/api/auth/complete-setup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        name: fullName,
        phone: cleanPhone,
        avatarUrl,
      }),
    });
    const activationBody = await activation.json().catch(() => ({}));
    if (!activation.ok) {
      setError(activationBody?.error || "Could not activate workspace access. Please try again.");
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);
    setTimeout(() => { window.location.replace("/"); }, 700);
  };

  if (success) {
    return (
      <div className="min-h-dvh bg-[#f8f9fb] dark:bg-[#09090b] flex items-center justify-center p-4">
        <div className="w-full max-w-[400px] text-center space-y-4">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center">
            <CheckCircle className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
          </div>
          <h1 className="text-[20px] font-bold text-gray-900 dark:text-white">You&apos;re all set!</h1>
          <p className="text-[13px] text-gray-500 dark:text-gray-400">Account created. Opening your workspace...</p>
          <div className="w-8 h-8 mx-auto border-3 border-gray-200 border-t-[#975428] rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-[#f8f9fb] dark:bg-[#09090b] flex items-center justify-center p-4">
      <div className="w-full max-w-[460px]">
        <div className="bg-white dark:bg-[#131316] rounded-2xl border border-gray-200/80 dark:border-white/[0.06] shadow-[0_1px_3px_rgba(0,0,0,0.04),0_6px_24px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.2),0_6px_24px_rgba(0,0,0,0.15)] overflow-hidden">

          {/* Header */}
          <div className="bg-gradient-to-r from-[#975428] to-[#6C655A] px-7 py-6">
            <div className="flex items-center gap-4">
              <RawImage src="/the-reach-logo.png" alt="The Reach" className="w-10 h-10 rounded-xl object-contain bg-white/20 backdrop-blur-sm p-1.5" />
              <div>
                <h1 className="text-[18px] font-bold text-white tracking-tight">Complete Your Profile</h1>
                <p className="text-[12px] text-white/70 mt-0.5">Welcome to The Reach team</p>
              </div>
            </div>
          </div>

          {/* Invite info badge */}
          {(inviteEmail || inviteRole) && (
            <div className="mx-6 mt-5 flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 dark:bg-white/[0.03] border border-gray-100 dark:border-white/[0.05]">
              <Shield className="w-3.5 h-3.5 text-[#975428] shrink-0" />
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
            {/* Profile Photo */}
            <div className="flex flex-col items-center gap-2">
              <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em]">Profile Photo <span className="text-red-400">*</span></label>
              <label className="cursor-pointer group p-1.5">
                <input type="file" accept="image/*" onChange={handleAvatarSelect} className="hidden" />
                <div className="w-24 h-24 sm:w-20 sm:h-20 rounded-full border-2 border-dashed border-gray-300 dark:border-white/[0.12] group-hover:border-[#975428] dark:group-hover:border-[#975428] transition-colors flex items-center justify-center overflow-hidden bg-gray-50 dark:bg-white/[0.04]">
                  {avatarPreview ? (
                    <RawImage src={avatarPreview} alt="Preview" className="w-full h-full object-cover" />
                  ) : (
                    <Camera className="w-6 h-6 text-gray-300 dark:text-gray-600 group-hover:text-[#975428] transition-colors" />
                  )}
                </div>
              </label>
              <p className="text-[10px] text-gray-400">{avatarPreview ? "Click to change" : "Click to upload"}</p>
            </div>

            {/* Name row */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em]">First Name <span className="text-red-400">*</span></label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300 dark:text-gray-600" />
                  <input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="First" autoComplete="given-name" className={`${inputClass} pl-10`} autoFocus />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em]">Last Name <span className="text-red-400">*</span></label>
                <input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Last" autoComplete="family-name" className={inputClass} />
              </div>
            </div>

            {/* WhatsApp */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em]">WhatsApp Number <span className="text-red-400">*</span></label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300 dark:text-gray-600" />
                <input type="tel" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="+63 912 345 6789" autoComplete="tel" className={`${inputClass} pl-10 font-mono`} />
              </div>
              <p className="text-[10px] text-gray-400">Include country code. Used for team communication.</p>
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em]">Password <span className="text-red-400">*</span></label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300 dark:text-gray-600" />
                <input type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Minimum 8 characters" autoComplete="new-password" className={`${inputClass} pl-10 pr-10`} />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 cursor-pointer">
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {password.length > 0 && password.length < 8 && <p className="text-[10px] text-[#975428]">Must be at least 8 characters</p>}
            </div>

            {/* Confirm */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em]">Confirm Password <span className="text-red-400">*</span></label>
              <input type={showPassword ? "text" : "password"} value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Re-enter password" autoComplete="new-password" className={inputClass} />
              {confirm.length > 0 && password !== confirm && <p className="text-[10px] text-red-500">Passwords don&apos;t match</p>}
            </div>

            <button type="submit" disabled={!canSubmit} className="reach-action-button w-full h-11 rounded-xl bg-[#975428] hover:bg-[#7f4421] text-white text-[13px] font-bold shadow-lg shadow-[#975428]/20 disabled:opacity-40 transition-all cursor-pointer flex items-center justify-center gap-2">
              {loading ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Setting up...</> : "Create Account & Enter Dashboard"}
            </button>
          </form>
        </div>

        <p className="text-center text-[10px] text-gray-400 dark:text-gray-600 mt-4">The Reach</p>
      </div>

      {cropImageSrc && (
        <ToastProvider>
          <AvatarCropModal
            imageSrc={cropImageSrc}
            onCropComplete={handleCroppedAvatar}
            onClose={() => setCropImageSrc(null)}
          />
          <ToastContainer />
        </ToastProvider>
      )}
    </div>
  );
}
