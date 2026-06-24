"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";
import { AvatarCropModal } from "@/components/avatar-crop-modal";
import { OptimizedAvatar } from "@/components/optimized-avatar";
import { useTheme } from "@/lib/theme-context";
import { useTeam, UserRole, TeamMember } from "@/lib/team-context";
import { useToast } from "@/lib/toast-context";
import { useAuth } from "@/lib/auth-context";
import { useNavigation } from "@/lib/navigation-context";
import { usePresence } from "@/lib/use-presence";
import { PresenceDot } from "@/components/presence-dot";
import { PresenceLabel } from "@/components/presence-label";
import { usePipeline } from "@/lib/pipeline-context";
import { setManualPostedMovesEnabled, useManualPostedMovesSetting } from "@/lib/manual-posted-settings";
import { withStorageUploadTimeout } from "@/lib/storage-upload-timeout";
import { ThemeSelector } from "@/components/theme-selector";
import { fetchAllAuditLogs, AuditEntry } from "@/lib/audit";
import { History, ArrowUpRight, Search, FileText as FileTextIcon, Shield as ShieldIcon, AtSign, ArrowUpDown, Filter, ChevronRight, CheckCircle, Activity, Clock as ClockIcon } from "lucide-react";
import { formatDateTime, formatDateShort, formatDateTimeCompact } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlatformIcon } from "@/components/platform-icons";
import {
  Database, Key, Bell, Palette, HardDrive, ExternalLink, Globe, Clock,
  Shield, Download, Sun, Moon, Mail,
  Smartphone, BarChart3, Zap, Link2, Webhook, FileText,
  UserPlus, ShieldCheck, Pencil, Eye, Crown, X, Send, Megaphone, Users, Settings as SettingsIcon,
  Save, Upload, Trash2, RefreshCw, Loader2,
  Maximize2,
} from "lucide-react";

const roleConfig: Record<UserRole, { label: string; icon: React.ReactNode; color: string }> = {
  superadmin: { label: "Super Admin", icon: <Crown className="w-3 h-3" />, color: "text-amber-600 bg-amber-50 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20" },
  admin: { label: "Admin", icon: <ShieldCheck className="w-3 h-3" />, color: "text-blue-600 bg-blue-50 border-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20" },
  approver: { label: "Approver", icon: <CheckCircle className="w-3 h-3" />, color: "text-emerald-600 bg-emerald-50 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20" },
  creative_director: { label: "Creative Director", icon: <Eye className="w-3 h-3" />, color: "text-violet-600 bg-violet-50 border-violet-200 dark:bg-violet-500/10 dark:text-violet-400 dark:border-violet-500/20" },
  social_media_specialist: { label: "Social Media Specialist", icon: <Megaphone className="w-3 h-3" />, color: "text-purple-600 bg-purple-50 border-purple-200 dark:bg-purple-500/10 dark:text-purple-400 dark:border-purple-500/20" },
  video_editor: { label: "Video Editor", icon: <Pencil className="w-3 h-3" />, color: "text-orange-600 bg-orange-50 border-orange-200 dark:bg-orange-500/10 dark:text-orange-400 dark:border-orange-500/20" },
  graphic_designer: { label: "Graphic Designer", icon: <Palette className="w-3 h-3" />, color: "text-pink-600 bg-pink-50 border-pink-200 dark:bg-pink-500/10 dark:text-pink-400 dark:border-pink-500/20" },
};

function AvatarLightbox({
  member,
  onClose,
  canChange,
  onChange,
}: {
  member: TeamMember;
  onClose: () => void;
  canChange?: boolean;
  onChange?: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[70] bg-black/80 dark:bg-black/85 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-[520px] rounded-2xl border border-white/[0.10] bg-[#151518] shadow-2xl overflow-hidden"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${member.name} profile photo`}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08]">
          <div className="min-w-0">
            <p className="text-[15px] font-semibold text-white truncate">{member.name}</p>
            <p className="text-[11px] text-gray-500 truncate">{member.email}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-white/[0.06] cursor-pointer" aria-label="Close photo">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-8 flex flex-col items-center gap-5">
          <div
            className="relative rounded-full overflow-hidden border border-white/[0.12] bg-white/[0.04] shadow-[0_18px_60px_rgba(0,0,0,0.35)]"
            style={{ width: "min(78vw, 78vh, 640px)", height: "min(78vw, 78vh, 640px)" }}
          >
            <OptimizedAvatar
              src={member.avatar}
              name={member.name}
              width={640}
              height={640}
              eager
              className="w-full h-full object-cover"
              fallbackClassName="w-full h-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-6xl sm:text-8xl font-bold text-white"
            />
          </div>
          {canChange && onChange && (
            <Button type="button" onClick={onChange} className="reach-secondary-action h-9 rounded-lg text-[12px] px-4 cursor-pointer">
              <Upload className="w-3.5 h-3.5 mr-1.5" />Change Photo
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Edit Profile Modal ───
function EditProfileModal({
  member,
  onClose,
  onDelete,
  canDelete,
  canManageTeam,
  canEditProfile,
}: {
  member: TeamMember;
  onClose: () => void;
  onDelete?: () => void;
  canDelete?: boolean;
  canManageTeam: boolean;
  canEditProfile: boolean;
}) {
  const { updateMember, refreshMembers } = useTeam();
  const { addToast } = useToast();
  const { currentUser, updateCurrentUserAvatar, logout } = useAuth();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [name, setName] = useState(member.name);
  const [email, setEmail] = useState(member.email);
  const [phone, setPhone] = useState(member.phone || "");
  const [role, setRole] = useState<UserRole>(member.role);
  const [avatarUrl, setAvatarUrl] = useState(member.avatar || "");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sendingRecovery, setSendingRecovery] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Avatar crop flow
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);
  const isSelf = member.email.toLowerCase() === currentUser.email.toLowerCase();
  const normalizedEmail = email.trim().toLowerCase();
  const emailChanged = normalizedEmail !== member.email.toLowerCase();
  const canChangeEmail = isSelf || (canManageTeam && member.status === "pending" && member.role !== "superadmin");
  const canEditRole = canManageTeam && member.role !== "superadmin";
  const canSave = (canEditProfile || canManageTeam || (emailChanged && canChangeEmail)) && !saving;
  const canSendRecovery = isSelf || canManageTeam;
  const canChangeAvatar = canEditProfile || canManageTeam;

  const sendPasswordRecovery = async () => {
    if (!canSendRecovery || sendingRecovery) return;
    setSendingRecovery(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail }),
      });
      if (!res.ok) {
        addToast("Recovery email could not be requested.", "error");
        return;
      }
      addToast(`Recovery link sent to ${normalizedEmail}`, "success");
    } catch {
      addToast("Network error. Recovery link not sent.", "error");
    } finally {
      setSendingRecovery(false);
    }
  };

  const handleAvatarSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canChangeAvatar) return;
    const file = e.target.files?.[0];
    if (!file) return;
    const src = URL.createObjectURL(file);
    setCropImageSrc(src);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleCroppedAvatar = async (croppedBlob: Blob) => {
    setCropImageSrc(null);
    setUploading(true);

    const useDb = !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

    try {
      if (useDb) {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user?.id) {
          addToast("Upload failed. Please sign in again.", "error");
          return;
        }
        const path = `profiles/${user.id}/${member.id}-${Date.now()}.jpg`;
        const { error } = await withStorageUploadTimeout(
          supabase.storage.from("avatars").upload(path, croppedBlob, { upsert: true, contentType: "image/jpeg", cacheControl: "31536000" }),
          croppedBlob.size,
          "Profile photo upload",
        );
        if (!error) {
          const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path);
          setAvatarUrl(urlData.publicUrl);
          addToast("Photo cropped & uploaded", "success");
        } else {
          addToast("Upload failed. Check Supabase storage bucket.", "error");
        }
      } else {
        setAvatarUrl(URL.createObjectURL(croppedBlob));
        addToast("Photo cropped (local only)", "info");
      }
    } catch {
      // A thrown/hung auth or storage call must never strand the avatar spinner.
      addToast("Upload failed. Check your connection and try again.", "error");
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    if (!canSave) return;
    if (!name.trim()) {
      addToast("Name is required.", "error");
      return;
    }
    if (emailChanged && !/^[^\s@\r\n]+@[^\s@\r\n]+\.[^\s@\r\n]+$/.test(normalizedEmail)) {
      addToast("Enter a valid email address.", "error");
      return;
    }
    setSaving(true);
    try {
      if (emailChanged) {
        if (!canChangeEmail) {
          addToast("Active members must change their own email while signed in.", "error");
          return;
        }
        const { data: { session } } = await supabase.auth.getSession();
        const headers: HeadersInit = { "Content-Type": "application/json" };
        if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
        const res = await fetch("/api/team/change-email", {
          method: "POST",
          headers,
          body: JSON.stringify({ memberId: member.id, newEmail: normalizedEmail, name: name.trim(), role }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          addToast(data.error || "Email change failed.", "error");
          return;
        }
        if (data.emailSent) {
          addToast(`Invite email updated and sent to ${normalizedEmail}`, "success");
        } else if (data.inviteUrl) {
          await navigator.clipboard.writeText(data.inviteUrl);
          addToast("Invite email updated. New invite link copied.", "info");
        } else {
          addToast(data.message || "Email updated.", "success");
        }
      }

      if (canManageTeam) {
        const updates: Partial<TeamMember> = {
          name: name.trim(),
          phone: phone || undefined,
          avatar: avatarUrl || undefined,
        };
        if (canEditRole) updates.role = role;
        const profileSaved = await updateMember(member.id, updates);
        if (!profileSaved) return;
      }
      if (isSelf) {
        updateCurrentUserAvatar(avatarUrl || undefined);
      }
      await refreshMembers();
      if (emailChanged && isSelf) {
        addToast("Email changed. Sign back in with the new email.", "success");
        onClose();
        await logout();
        return;
      }
      addToast(`Profile updated for ${name.trim()}`, "success");
      onClose();
    } catch {
      addToast("Network error. Profile was not updated.", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 bg-black/30 dark:bg-black/60 z-50" />
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="bg-white dark:bg-[#151518] rounded-2xl border border-gray-200 dark:border-white/[0.08] shadow-2xl w-full max-w-[420px]">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-white/[0.06]">
            <h2 className="text-[15px] font-semibold text-gray-900 dark:text-white">Edit Profile</h2>
            <button onClick={onClose} className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-white/[0.06] text-gray-400 cursor-pointer"><X className="w-4 h-4" /></button>
          </div>
          <div className="p-5 space-y-4">
            {/* Avatar */}
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleAvatarSelect} className="hidden" />
            <div className="flex justify-center">
              <div className="relative group">
                <button type="button" onClick={() => setPhotoOpen(true)} className="relative rounded-full cursor-zoom-in block" aria-label={`Open ${name}'s profile photo`}>
                  <OptimizedAvatar
                    src={avatarUrl}
                    name={name}
                    width={80}
                    height={80}
                    eager
                    className="w-20 h-20 rounded-full object-cover"
                    fallbackClassName="w-20 h-20 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-[22px] font-bold text-white"
                  />
                  <span className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Maximize2 className="w-5 h-5 text-white" />
                  </span>
                </button>
                <button disabled={!canChangeAvatar} onClick={() => fileInputRef.current?.click()} className="reach-secondary-action absolute -bottom-1 -right-1 w-6 h-6 rounded-full border-2 border-white dark:border-[#151518] flex items-center justify-center cursor-pointer transition-colors disabled:cursor-not-allowed disabled:opacity-50" aria-label="Change profile photo">
                  {uploading ? (
                    <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Upload className="w-3 h-3 text-white" />
                  )}
                </button>
              </div>
            </div>

            {/* Name */}
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.08em]">Full Name</label>
              <Input disabled={!canManageTeam} value={name} onChange={(e) => setName(e.target.value)} className="h-9 bg-gray-50 dark:bg-white/[0.04] border-gray-200 dark:border-white/[0.08] rounded-lg text-[13px] text-gray-800 dark:text-gray-200" />
            </div>

            {/* Email */}
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.08em]">Sign-in Email</label>
              <Input disabled={!canChangeEmail || saving} type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-9 bg-gray-50 dark:bg-white/[0.04] border-gray-200 dark:border-white/[0.08] rounded-lg text-[13px] text-gray-800 dark:text-gray-200" />
              <p className="text-[10px] text-gray-400 dark:text-gray-500">
                {isSelf
                  ? "Changing this signs you out so Supabase can issue a fresh session."
                  : member.status === "pending"
                    ? "Pending invite changes generate a fresh invite link."
                    : "Active members must change their own email while signed in."}
              </p>
            </div>

            {/* Phone */}
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.08em]">Phone / WhatsApp</label>
              <Input disabled={!canManageTeam} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 234 567 8900" className="h-9 bg-gray-50 dark:bg-white/[0.04] border-gray-200 dark:border-white/[0.08] rounded-lg text-[13px] text-gray-800 dark:text-gray-200 font-mono" />
            </div>

            {/* Role */}
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.08em]">Role</label>
              {!canEditRole ? (
                <div className="h-9 px-3 flex items-center rounded-lg bg-amber-50 dark:bg-amber-500/5 border border-amber-200 dark:border-amber-500/20 text-[13px] text-amber-700 dark:text-amber-400 font-medium">
                  <Crown className="w-3.5 h-3.5 mr-2" />{roleConfig[member.role]?.label || member.role}
                </div>
              ) : (
                <select value={role} onChange={(e) => setRole(e.target.value as UserRole)} className="w-full h-9 px-3 rounded-lg bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] text-[13px] text-gray-700 dark:text-gray-300 outline-none cursor-pointer">
                  {Object.entries(roleConfig).filter(([key]) => key !== "superadmin").map(([key, conf]) => (
                    <option key={key} value={key}>{conf.label}</option>
                  ))}
                </select>
              )}
            </div>

            {/* Password recovery */}
            {canSendRecovery && (
              <div className="rounded-xl border border-gray-100 dark:border-white/[0.06] bg-gray-50/70 dark:bg-white/[0.02] px-3 py-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-white dark:bg-white/[0.04] border border-gray-100 dark:border-white/[0.06] flex items-center justify-center shrink-0">
                    <Key className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-medium text-gray-700 dark:text-gray-300">Password recovery</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">Email a secure reset link to this sign-in address.</p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={sendingRecovery || !normalizedEmail}
                    onClick={sendPasswordRecovery}
                    className="h-8 rounded-lg text-[10px] px-3 cursor-pointer disabled:opacity-60"
                  >
                    {sendingRecovery ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <Mail className="w-3 h-3 mr-1.5" />}
                    Send Link
                  </Button>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-2">
              <Button variant="outline" onClick={onClose} className="flex-1 h-9 rounded-lg text-[12px]">Cancel</Button>
              <Button disabled={!canSave} onClick={handleSave} className="reach-secondary-action flex-1 h-9 rounded-lg text-[12px] shadow-sm disabled:opacity-40">
                {saving ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1.5" />}Save Changes
              </Button>
            </div>

            {/* Delete member — only shown for admins/owners, never for owners */}
            {canDelete && onDelete && (
              <div className="pt-3 mt-1 border-t border-gray-100 dark:border-white/[0.06]">
                {!confirmDelete ? (
                  <button onClick={() => setConfirmDelete(true)} className="w-full flex items-center justify-center gap-1.5 text-[11px] text-gray-400 hover:text-red-500 transition-colors cursor-pointer py-1.5">
                    <Trash2 className="w-3 h-3" />Remove from team
                  </button>
                ) : (
                  <div className="bg-red-50 dark:bg-red-500/5 rounded-lg border border-red-200 dark:border-red-500/20 p-3 space-y-2">
                    <p className="text-[11px] text-red-700 dark:text-red-400 font-medium text-center">Remove {member.name} from the team?</p>
                    <p className="text-[10px] text-red-500/70 dark:text-red-400/60 text-center">This will revoke their access immediately.</p>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setConfirmDelete(false)} className="flex-1 h-8 rounded-lg text-[11px]">Cancel</Button>
                      <Button size="sm" onClick={() => { onDelete(); onClose(); }} className="flex-1 h-8 rounded-lg bg-red-600 hover:bg-red-700 text-white text-[11px]">
                        <Trash2 className="w-3 h-3 mr-1" />Remove
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Avatar crop modal */}
      {cropImageSrc && (
        <AvatarCropModal
          imageSrc={cropImageSrc}
          onCropComplete={handleCroppedAvatar}
          onClose={() => { setCropImageSrc(null); }}
        />
      )}
      {photoOpen && (
        <AvatarLightbox
          member={{ ...member, name, email: normalizedEmail, phone: phone || undefined, role, avatar: avatarUrl || undefined }}
          onClose={() => setPhotoOpen(false)}
          canChange={canChangeAvatar}
          onChange={() => {
            setPhotoOpen(false);
            fileInputRef.current?.click();
          }}
        />
      )}
    </>
  );
}

function ConnectedBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-semibold uppercase tracking-wider bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-500/20">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />Connected
    </span>
  );
}

function ActiveBadge({ label = "Active" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-semibold uppercase tracking-wider bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-500/20">
      <CheckCircle className="w-3 h-3" />{label}
    </span>
  );
}

function ComingSoonBadge() {
  return (
    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[9px] font-semibold uppercase tracking-wider bg-gradient-to-r from-gray-100 to-gray-50 dark:from-white/[0.06] dark:to-white/[0.03] text-gray-400 dark:text-gray-500 border border-gray-200/60 dark:border-white/[0.06]">
      Coming Soon
    </span>
  );
}

// ─── Main Settings Page ───
export function SettingsPage() {
  const { theme, toggleTheme } = useTheme();
  const { members, removeMember, pendingRequests, refreshMembers, refreshPendingRequests } = useTeam();
  const { currentUser } = useAuth();
  const { navigate } = useNavigation();
  const { addToast } = useToast();
  const { workspaceId } = usePipeline();
  const manualPostedMovesSetting = useManualPostedMovesSetting();
  const [manualPostedSaving, setManualPostedSaving] = useState(false);
  const [workspaceTz, setWorkspaceTz] = useState("America/Chicago");
  const currentMember = members.find((m) => m.email === currentUser.email);
  const isAdmin = currentMember?.role === "superadmin" || currentMember?.role === "admin";
  const isSuperadmin = currentMember?.role === "superadmin";
  const canViewAudit = isAdmin || currentMember?.role === "approver" || currentMember?.role === "creative_director";
  const { getStatus } = usePresence(currentUser.email, workspaceId);
  const [activeTab, setActiveTab] = useState<"general" | "team" | "audit" | "themes">("general");
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<UserRole>("social_media_specialist");
  const [inviting, setInviting] = useState(false);
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null);
  const [activeIntegration, setActiveIntegration] = useState<string | null>(null);
  const [approving, setApproving] = useState<string | null>(null);
  const [resendingInvite, setResendingInvite] = useState<string | null>(null);
  const [sendingOwnRecovery, setSendingOwnRecovery] = useState(false);
  const [photoViewer, setPhotoViewer] = useState<{ member: TeamMember; canChange: boolean } | null>(null);

  // Load workspace timezone on mount
  useEffect(() => {
    if (!workspaceId) return;
    supabase.from("workspaces").select("timezone").eq("id", workspaceId).maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          console.warn("[settings] workspace timezone load failed:", error.message);
          return;
        }
        if (data?.timezone) setWorkspaceTz(data.timezone);
      });
  }, [workspaceId]);

  const activeMembers = useMemo(() => members.filter((m) => m.status === "active"), [members]);
  const pendingMembers = useMemo(() => members.filter((m) => m.status === "pending"), [members]);
  const pendingInviteByEmail = useMemo(
    () => new Map(pendingMembers.map((m) => [m.email.toLowerCase(), m])),
    [pendingMembers],
  );
  const pendingRequestByEmail = useMemo(
    () => new Map(pendingRequests.map((req) => [req.email.toLowerCase(), req])),
    [pendingRequests],
  );
  const openBrandKitCopy = useCallback((focus: "hashtags" | "captions") => {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem("reach_brandkit_tab", "copy");
      window.sessionStorage.setItem("reach_brandkit_focus", focus);
    }
    navigate("brandkit");
  }, [navigate]);

  const sendPasswordRecovery = useCallback(async (email: string) => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      addToast("No email address found for this account.", "error");
      return false;
    }
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: cleanEmail }),
      });
      if (!res.ok) {
        addToast("Recovery email could not be requested.", "error");
        return false;
      }
      addToast(`Recovery link sent to ${cleanEmail}`, "success");
      return true;
    } catch {
      addToast("Network error. Recovery link not sent.", "error");
      return false;
    }
  }, [addToast]);

  const handleOwnPasswordRecovery = useCallback(async () => {
    if (sendingOwnRecovery) return;
    setSendingOwnRecovery(true);
    try {
      await sendPasswordRecovery(currentUser.email);
    } finally {
      setSendingOwnRecovery(false);
    }
  }, [currentUser.email, sendPasswordRecovery, sendingOwnRecovery]);

  const handleApprove = async (reqId: string, action: "approve" | "reject", role = "social_media_specialist", hasExistingInvite = false) => {
    setApproving(reqId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
      const res = await fetch("/api/team/approve-request", {
        method: "POST",
        headers,
        body: JSON.stringify({ requestId: reqId, action, role, reviewedBy: currentUser.email }),
      });
      const data = await res.json();
      if (res.ok) {
        refreshPendingRequests();
        void refreshMembers();
        if (action === "approve" && data.emailSent === false && data.inviteUrl) {
          await navigator.clipboard.writeText(data.inviteUrl);
          addToast(data.reusedPendingInvite ? "Invite refreshed. Email failed, link copied to clipboard." : "Approved. Email failed, invite link copied to clipboard.", "info");
        } else if (action === "approve" && data.reusedPendingInvite) {
          addToast("Invite refreshed and request marked approved.", "success");
        } else if (action === "reject" && hasExistingInvite) {
          addToast("Request dismissed. Pending invite remains available.", "info");
        } else {
          addToast(action === "approve" ? `Approved. Branded invite sent.` : "Request rejected", action === "approve" ? "success" : "info");
        }
      } else {
        addToast(data.error || "Action failed", "error");
      }
    } catch {
      addToast("Network error", "error");
    } finally {
      setApproving(null);
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    if (!inviteEmail.trim() || !inviteName.trim() || inviting) return;
    setInviting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
      const res = await fetch("/api/team/invite", {
        method: "POST",
        headers,
        body: JSON.stringify({
          email: inviteEmail.trim(),
          name: inviteName.trim(),
          role: inviteRole,
          requestedBy: currentUser.email,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        addToast(data.error || "Invite failed", "error");
        return;
      }
      if (data.emailSent) {
        addToast(`Invite email sent to ${inviteEmail.trim()}`, "success");
      } else if (data.inviteUrl) {
        // Email failed but user was created — copy invite link
        await navigator.clipboard.writeText(data.inviteUrl);
        addToast(`Email failed. Invite link copied to clipboard. Share it manually.`, "info");
      } else {
        addToast(`Invited ${inviteName.trim()}, but email delivery uncertain`, "info");
      }
      void refreshMembers();
      refreshPendingRequests();
      setInviteEmail(""); setInviteName(""); setShowInvite(false);
    } catch {
      addToast("Network error. Invite not sent.", "error");
    } finally {
      setInviting(false);
    }
  };

  const handleResendInvite = async (member: TeamMember) => {
    if (!isAdmin) return;
    setResendingInvite(member.id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
      const res = await fetch("/api/team/resend-invite", {
        method: "POST",
        headers,
        body: JSON.stringify({ email: member.email, name: member.name, role: member.role, requestedBy: currentUser.email }),
      });
      const data = await res.json();
      if (res.ok) {
        if (data.emailSent) {
          addToast(`Invite resent to ${member.email}`, "success");
        } else if (data.inviteUrl) {
          await navigator.clipboard.writeText(data.inviteUrl);
          addToast(`Email failed. Invite link copied to clipboard.`, "info");
        }
      } else {
        addToast(data.error || "Resend failed", "error");
      }
    } catch {
      addToast("Network error", "error");
    } finally {
      setResendingInvite(null);
      void refreshMembers();
    }
  };

  return (
    <div className="p-5 max-w-[760px] mx-auto w-full space-y-4">
      <div>
        <h1 className="text-[18px] font-bold text-gray-900 dark:text-white tracking-[-0.02em]">Settings</h1>
        <p className="text-[13px] text-gray-400 mt-0.5">Workspace configuration, team, and integrations</p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-gray-100 dark:border-white/[0.06] overflow-x-auto -mx-5 px-5">
        {[
          { id: "general" as const, label: "General", icon: <SettingsIcon className="w-3.5 h-3.5" /> },
          { id: "team" as const, label: "Team Members", icon: <Users className="w-3.5 h-3.5" />, badge: pendingRequests.length > 0 ? pendingRequests.length : undefined },
          { id: "themes" as const, label: "Themes", icon: <Palette className="w-3.5 h-3.5" /> },
          ...(canViewAudit ? [{ id: "audit" as const, label: "Audit Logs", icon: <FileText className="w-3.5 h-3.5" /> }] : []),
        ].map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-[12px] font-medium border-b-2 -mb-px transition-colors cursor-pointer ${activeTab === tab.id ? "border-blue-600 text-blue-700 dark:text-blue-400" : "border-transparent text-gray-400 hover:text-gray-600"}`}>
            {tab.icon}{tab.label}
            {tab.id === "team" && <span className="text-[9px] bg-gray-100 dark:bg-white/[0.06] text-gray-500 px-1.5 rounded-full">{activeMembers.length}</span>}
            {tab.id === "team" && pendingRequests.length > 0 && <span className="w-4 h-4 rounded-full bg-amber-500 text-white text-[8px] font-bold flex items-center justify-center animate-pulse">{pendingRequests.length}</span>}
          </button>
        ))}
      </div>

      {activeTab === "themes" ? (
        <div className="py-6 px-4">
          <ThemeSelector />
        </div>
      ) : activeTab === "audit" ? (
        <AuditLogTab auditLogs={auditLogs} auditLoading={auditLoading} setAuditLogs={setAuditLogs} setAuditLoading={setAuditLoading} />
      ) : activeTab === "general" ? (
        <div className="space-y-4">
          <Section title="Workspace" icon={<Globe className="w-3.5 h-3.5 text-blue-500" />}>
            <SettingRow icon={Palette} label="Appearance" desc="Choose your preferred theme">
              <div className="flex gap-1.5">
                {[{ value: "light", icon: Sun, label: "Light" }, { value: "dark", icon: Moon, label: "Dark" }].map((t) => (
                  <button key={t.value} onClick={theme !== t.value ? toggleTheme : undefined}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium border cursor-pointer ${theme === t.value ? "bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-500/10 dark:border-blue-500/30 dark:text-blue-400" : "bg-white border-gray-200 text-gray-500 dark:bg-transparent dark:border-white/[0.08] dark:text-gray-400"}`}>
                    <t.icon className="w-3.5 h-3.5" />{t.label}
                  </button>
                ))}
              </div>
            </SettingRow>
            <SettingRow icon={Clock} label="Timezone" desc="Scheduled posts use this timezone">
              <select
                value={workspaceTz}
                onChange={async (e) => {
                  const newTz = e.target.value;
                  setWorkspaceTz(newTz);
                  if (workspaceId) {
                    const { error } = await supabase.from("workspaces").update({ timezone: newTz }).eq("id", workspaceId);
                    if (error) {
                      addToast("Timezone update failed. Try again.", "error");
                      return;
                    }
                    addToast("Timezone updated", "success");
                  }
                }}
                className="h-8 px-3 rounded-lg bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] text-[11px] text-gray-600 dark:text-gray-300 outline-none cursor-pointer"
              >
                <option value="America/Los_Angeles">Pacific Time (PT)</option>
                <option value="America/Denver">Mountain Time (MT)</option>
                <option value="America/Chicago">Central Time (CT)</option>
                <option value="America/New_York">Eastern Time (ET)</option>
                <option value="UTC">UTC</option>
              </select>
            </SettingRow>
            <SettingRow icon={Key} label="Password" desc={`Send a secure reset link to ${currentUser.email}`}>
              <Button
                size="sm"
                variant="outline"
                disabled={sendingOwnRecovery}
                onClick={handleOwnPasswordRecovery}
                className="h-7 text-[10px] rounded-lg px-3 cursor-pointer disabled:opacity-60"
              >
                {sendingOwnRecovery ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <Mail className="w-3 h-3 mr-1.5" />}
                Send Reset Link
              </Button>
            </SettingRow>
          </Section>

          <Section title="Connected Accounts" icon={<Link2 className="w-3.5 h-3.5 text-emerald-500" />}>
            {(["facebook", "instagram", "linkedin", "youtube", "tiktok"] as const).map((p) => (
              <div key={p} className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-50 dark:border-white/[0.03] last:border-0">
                <span className="text-gray-600 dark:text-gray-400"><PlatformIcon platform={p} className="w-4.5 h-4.5" /></span>
                <span className="flex-1 text-[12px] font-medium text-gray-700 dark:text-gray-300 capitalize">{p}</span>
                <Button size="sm" variant="outline" onClick={() => addToast(`${p.charAt(0).toUpperCase() + p.slice(1)} integration coming soon`, "info")} className="h-7 text-[10px] rounded-lg px-3 cursor-pointer">Connect</Button>
              </div>
            ))}
          </Section>

          {/* UX-013: disabled toggles show system status only. Rows backed by
              real routes/workers are marked active; unwired preferences remain
              Coming Soon so the UI does not imply a saved per-user setting. */}
          <Section title="Publishing" icon={<Zap className="w-3.5 h-3.5 text-amber-500" />}>
            <SettingRow icon={Clock} label="Auto-publish" desc="n8n claims approved posts at scheduled time"><div className="flex items-center gap-2"><ActiveBadge /><Toggle defaultOn disabled /></div></SettingRow>
            {isSuperadmin && (
              <SettingRow icon={Send} label="Manual Posted moves" desc="Temporarily let approvers move approved cards to Posted">
                <Toggle
                  checked={manualPostedMovesSetting.enabled}
                  disabled={manualPostedMovesSetting.loading || manualPostedSaving}
                  ariaLabel="Manual Posted moves"
                  onChange={async (enabled) => {
                    setManualPostedSaving(true);
                    try {
                      await setManualPostedMovesEnabled(enabled);
                      addToast(enabled ? "Manual Posted moves enabled" : "Manual Posted moves disabled", "success");
                    } catch (err) {
                      const message = err instanceof Error ? err.message : "Could not update Manual Posted moves";
                      addToast(message, "error");
                      await manualPostedMovesSetting.refresh();
                    } finally {
                      setManualPostedSaving(false);
                    }
                  }}
                />
              </SettingRow>
            )}
            <SettingRow icon={BarChart3} label="Analytics tracking" desc="Track engagement after publishing"><div className="flex items-center gap-2"><ComingSoonBadge /><Toggle defaultOn disabled /></div></SettingRow>
            <SettingRow icon={FileText} label="Hashtag sets" desc="Reusable hashtag groups"><Button size="sm" variant="outline" onClick={() => openBrandKitCopy("hashtags")} className="h-7 text-[10px] rounded-lg px-3 cursor-pointer">Manage</Button></SettingRow>
            <SettingRow icon={Smartphone} label="Caption templates" desc="Saved caption formats"><Button size="sm" variant="outline" onClick={() => openBrandKitCopy("captions")} className="h-7 text-[10px] rounded-lg px-3 cursor-pointer">Manage</Button></SettingRow>
          </Section>

          <Section title="Notifications" icon={<Bell className="w-3.5 h-3.5 text-violet-500" />}>
            <SettingRow icon={Mail} label="Email notifications" desc="Approval, revision, invite, mention, and support emails are active"><div className="flex items-center gap-2"><ActiveBadge /><Toggle defaultOn disabled /></div></SettingRow>
            <SettingRow icon={Bell} label="Post reminders" desc="Publishing queue and health checks monitor scheduled posts"><div className="flex items-center gap-2"><ActiveBadge label="Monitored" /><Toggle defaultOn disabled /></div></SettingRow>
            <SettingRow icon={Shield} label="Team activity" desc="Stage moves, audit logs, and @mentions are tracked"><div className="flex items-center gap-2"><ActiveBadge /><Toggle defaultOn disabled /></div></SettingRow>
          </Section>

          {isAdmin && (
            <Section title="Integrations" icon={<Webhook className="w-3.5 h-3.5 text-sky-500" />}>
              {INTEGRATIONS.map((intg) => (
                <button key={intg.id} onClick={() => setActiveIntegration(intg.id)} className="w-full flex items-center gap-3 px-4 py-3 border-b border-gray-50 dark:border-white/[0.03] last:border-0 hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors cursor-pointer text-left group">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${intg.iconBg}`}>
                    <intg.icon className={`w-4 h-4 ${intg.iconColor}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-medium text-gray-700 dark:text-gray-300">{intg.name}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">{intg.desc}</p>
                  </div>
                  {intg.status === "connected" ? <ConnectedBadge /> : <ComingSoonBadge />}
                  <ChevronRight className="w-3.5 h-3.5 text-gray-200 dark:text-gray-700 group-hover:text-orange-400 transition-colors shrink-0" />
                </button>
              ))}
            </Section>
          )}

          {isAdmin && (
            <Section title="Publishing Queue" icon={<Send className="w-3.5 h-3.5 text-blue-500" />}>
              <PublishQueuePanel addToast={addToast} />
            </Section>
          )}

          {isAdmin && (
            <Section title="Data" icon={<Shield className="w-3.5 h-3.5 text-rose-500" />}>
              <SettingRow icon={Download} label="Export data" desc="Download posts, media, analytics as CSV"><Button size="sm" variant="outline" onClick={() => addToast("Data export coming soon", "info")} className="h-7 text-[10px] rounded-lg px-3 cursor-pointer">Export</Button></SettingRow>
            </Section>
          )}
        </div>
      ) : (
        /* Team tab */
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[13px] text-gray-500 dark:text-gray-400">{activeMembers.length} members with workspace access</p>
            {isAdmin && (
              <Button size="sm" onClick={() => setShowInvite(!showInvite)} className="reach-secondary-action h-8 rounded-lg text-[11px] font-medium cursor-pointer">
                <UserPlus className="w-3.5 h-3.5 mr-1.5" />Invite
              </Button>
            )}
          </div>

          {isAdmin && showInvite && (
            <form onSubmit={handleInvite} className="bg-white dark:bg-[#151518] rounded-xl border border-blue-200 dark:border-blue-500/20 p-4 space-y-2.5 shadow-sm shadow-blue-500/5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center"><UserPlus className="w-3 h-3 text-blue-600 dark:text-blue-400" /></div>
                  <h3 className="text-[12px] font-semibold text-gray-700 dark:text-gray-200">Invite Team Member</h3>
                </div>
                <button type="button" onClick={() => setShowInvite(false)} className="text-gray-400 hover:text-gray-600 cursor-pointer"><X className="w-4 h-4" /></button>
              </div>
              <p className="text-[10px] text-gray-400 dark:text-gray-500 -mt-1">A secure magic link will be sent to their email. No temporary passwords.</p>
              <Input placeholder="Full name" value={inviteName} onChange={(e) => setInviteName(e.target.value)} className="h-9 bg-gray-50 dark:bg-white/[0.04] border-gray-200 dark:border-white/[0.08] rounded-lg text-[12px] text-gray-800 dark:text-gray-200" autoFocus />
              <Input type="email" placeholder="email@example.com" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} className="h-9 bg-gray-50 dark:bg-white/[0.04] border-gray-200 dark:border-white/[0.08] rounded-lg text-[12px] text-gray-800 dark:text-gray-200" />
              <div className="flex gap-2">
                <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as UserRole)} className="h-9 px-3 rounded-lg bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] text-[12px] text-gray-600 dark:text-gray-300 outline-none cursor-pointer flex-1">
                  <option value="social_media_specialist">Social Media Specialist</option><option value="video_editor">Video Editor</option><option value="graphic_designer">Graphic Designer</option><option value="approver">Approver</option><option value="creative_director">Creative Director</option><option value="admin">Admin</option>
                </select>
                <Button type="submit" size="sm" disabled={inviting || !inviteEmail.trim() || !inviteName.trim()} className="reach-secondary-action h-9 rounded-lg text-[12px] px-5 cursor-pointer disabled:opacity-70">
                  {inviting ? <span className="flex items-center gap-1.5"><span className="w-3 h-3 border-2 border-[#E1DFD5]/30 border-t-[#E1DFD5] rounded-full animate-spin" />Sending...</span> : <><Send className="w-3 h-3 mr-1.5" />Send Invite</>}
                </Button>
              </div>
            </form>
          )}

          {/* Pending access requests — visible to ALL, approve/reject buttons for superadmin ONLY */}
          {isAdmin && pendingRequests.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-[0.08em] flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                Pending Access Requests ({pendingRequests.length})
              </h3>
              <div className="bg-white dark:bg-[#151518] rounded-2xl border border-amber-200/60 dark:border-amber-500/20 overflow-hidden shadow-sm">
                {pendingRequests.map((req, i) => {
                  const matchingInvite = pendingInviteByEmail.get(req.email.toLowerCase());
                  return (
                    <div key={req.id} className={`px-4 py-3 ${i > 0 ? "border-t border-amber-100 dark:border-amber-500/10" : ""}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="text-[13px] font-medium text-gray-800 dark:text-gray-200">{req.name}</p>
                            {matchingInvite && (
                              <Badge variant="outline" className="text-[10px] h-5 px-2 border text-amber-600 bg-amber-50 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20">
                                <Mail className="w-2.5 h-2.5 mr-1" />Pending Invite
                              </Badge>
                            )}
                          </div>
                          <p className="text-[11px] text-gray-400 mt-0.5">{req.email}{req.phone ? ` · ${req.phone}` : ""}</p>
                          {req.company && <p className="text-[10px] text-gray-400 mt-0.5">{req.company}</p>}
                          {req.reason && <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 italic">&ldquo;{req.reason}&rdquo;</p>}
                          <p className="text-[9px] text-gray-300 dark:text-gray-600 mt-1">{formatDateTimeCompact(req.created_at)}</p>
                        </div>
                        {/* Only superadmin sees approve/reject buttons */}
                        {isSuperadmin && (
                          <div className="flex gap-1.5 shrink-0">
                            <button disabled={approving === req.id} onClick={() => handleApprove(req.id, "reject", "social_media_specialist", Boolean(matchingInvite))}
                              className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-white/[0.08] text-[10px] font-medium text-gray-500 hover:text-red-500 hover:border-red-200 dark:hover:border-red-500/20 transition-colors cursor-pointer disabled:opacity-40">
                              {matchingInvite ? "Dismiss" : "Reject"}
                            </button>
                            <button disabled={approving === req.id} onClick={() => handleApprove(req.id, "approve", "social_media_specialist", Boolean(matchingInvite))}
                            className="reach-secondary-action px-3 py-1.5 rounded-lg text-[10px] font-medium cursor-pointer transition-colors disabled:opacity-40">
                              {approving === req.id ? "..." : matchingInvite ? "Approve & Resend" : "Approve"}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Active Members */}
          {activeMembers.length > 0 && (
            <div>
              <h3 className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em] mb-2">Active Members ({activeMembers.length})</h3>
              <div className="bg-white dark:bg-[#151518] rounded-2xl border border-gray-100 dark:border-white/[0.06] overflow-hidden shadow-sm">
                {activeMembers.map((member, i) => {
                  const role = roleConfig[member.role];
                  const canEditMember = member.email === currentUser.email || (isAdmin && (member.role !== "superadmin" || isSuperadmin));
                  const canChangePhoto = isAdmin && canEditMember;
                  return (
                    <div
                      key={member.id}
                      className={`w-full flex items-start gap-3 px-4 py-3.5 transition-colors text-left ${canEditMember ? "hover:bg-slate-50 dark:hover:bg-white/[0.02] cursor-pointer" : "cursor-default"} ${i > 0 ? "border-t border-gray-50 dark:border-white/[0.03]" : ""}`}>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setPhotoViewer({ member, canChange: canChangePhoto });
                        }}
                        className="relative shrink-0 mt-0.5 rounded-full cursor-zoom-in group/avatar"
                        aria-label={`Open ${member.name}'s profile photo`}
                      >
                        <OptimizedAvatar
                          src={member.avatar}
                          name={member.name}
                          width={36}
                          height={36}
                          eager={i < 6}
                          className="w-9 h-9 rounded-full object-cover"
                          fallbackClassName="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-[11px] font-bold text-white"
                        />
                        <span className="absolute inset-0 rounded-full bg-black/35 opacity-0 group-hover/avatar:opacity-100 transition-opacity flex items-center justify-center">
                          <Maximize2 className="w-3.5 h-3.5 text-white" />
                        </span>
                        <PresenceDot status={getStatus(member.email)} />
                      </button>
                      <div
                        role={canEditMember ? "button" : undefined}
                        tabIndex={canEditMember ? 0 : undefined}
                        onClick={canEditMember ? () => setEditingMember(member) : undefined}
                        onKeyDown={canEditMember ? (event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setEditingMember(member);
                          }
                        } : undefined}
                        className="flex-1 min-w-0"
                      >
                        <div className="flex items-center justify-between">
                          <p className="text-[13px] font-medium text-gray-800 dark:text-gray-200">{member.name}</p>
                          {canEditMember && <Pencil className="w-3.5 h-3.5 text-gray-300 shrink-0 ml-2" />}
                        </div>
                        <p className="text-[11px] text-gray-400 mt-0.5">{member.email}{member.phone ? ` · ${member.phone}` : ""}</p>
                        <div className="flex flex-wrap items-center gap-1.5 mt-2">
                          <Badge variant="outline" className={`text-[10px] h-5 px-2 border ${role?.color || "text-gray-500 bg-gray-50 border-gray-200"}`}>{role?.icon}<span className="ml-1">{role?.label || member.role}</span></Badge>
                          {member.updatedAt && (
                            <span className="text-[9px] text-gray-300 dark:text-gray-600 flex items-center gap-1">
                              <Clock className="w-2.5 h-2.5" />
                              Signed up {formatDateTime(member.updatedAt)}
                            </span>
                          )}
                        </div>
                        <PresenceLabel
                          email={member.email}
                          className="block mt-1 text-[10px] leading-tight"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Pending Invites */}
          {isAdmin && pendingMembers.length > 0 && (
            <div>
              <h3 className="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-[0.08em] mb-2 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                Pending Invites ({pendingMembers.length})
              </h3>
              <div className="bg-white dark:bg-[#151518] rounded-2xl border border-amber-200/60 dark:border-amber-500/20 overflow-hidden shadow-sm">
                {pendingMembers.map((member, i) => {
                  const role = roleConfig[member.role];
                  const matchingRequest = pendingRequestByEmail.get(member.email.toLowerCase());
                  return (
                    <div key={member.id} className={`flex items-center gap-3 px-4 py-3.5 ${i > 0 ? "border-t border-amber-100 dark:border-amber-500/10" : ""}`}>
                      <button
                        type="button"
                        onClick={() => setPhotoViewer({ member, canChange: isAdmin })}
                        className="relative shrink-0 rounded-full cursor-zoom-in group/avatar"
                        aria-label={`Open ${member.name}'s profile photo`}
                      >
                        <OptimizedAvatar
                          src={member.avatar}
                          name={member.name}
                          width={36}
                          height={36}
                          eager={i < 6}
                          className="w-9 h-9 rounded-full object-cover"
                          fallbackClassName="w-9 h-9 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-[11px] font-bold text-white"
                        />
                        <span className="absolute inset-0 rounded-full bg-black/35 opacity-0 group-hover/avatar:opacity-100 transition-opacity flex items-center justify-center">
                          <Maximize2 className="w-3.5 h-3.5 text-white" />
                        </span>
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-gray-800 dark:text-gray-200">{member.name}</p>
                        <p className="text-[11px] text-gray-400 mt-0.5">{member.email}</p>
                        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                          <Badge variant="outline" className={`text-[10px] h-5 px-2 border ${role?.color || "text-gray-500 bg-gray-50 border-gray-200"}`}>{role?.icon}<span className="ml-1">{role?.label || member.role}</span></Badge>
                          <Badge variant="outline" className="text-[10px] h-5 px-2 border text-amber-600 bg-amber-50 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20">
                            <Mail className="w-2.5 h-2.5 mr-1" />Invite Sent
                          </Badge>
                          {matchingRequest && (
                            <Badge variant="outline" className="text-[10px] h-5 px-2 border text-blue-600 bg-blue-50 border-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20">
                              <Activity className="w-2.5 h-2.5 mr-1" />Access Requested
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        <button onClick={() => setEditingMember(member)}
                          className="p-2 rounded-lg border border-gray-200 dark:border-white/[0.08] text-gray-400 hover:text-gray-600 hover:bg-gray-50 dark:hover:bg-white/[0.04] transition-colors cursor-pointer">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button disabled={resendingInvite === member.id} onClick={() => handleResendInvite(member)}
                          className="reach-action-button flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer disabled:opacity-70">
                          {resendingInvite === member.id ? (
                            <span className="w-3 h-3 border-2 border-[#E1DFD5]/30 border-t-[#E1DFD5] rounded-full animate-spin" />
                          ) : (
                            <RefreshCw className="w-3 h-3" />
                          )}
                          Resend
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Edit Profile Modal */}
      {editingMember && (
        <EditProfileModal
          member={editingMember}
          onClose={() => setEditingMember(null)}
          canManageTeam={isAdmin}
          canEditProfile={isAdmin}
          canDelete={
            editingMember.role !== "superadmin" &&
            (currentUser.email !== editingMember.email) &&
            members.some((m) => m.email === currentUser.email && (m.role === "superadmin" || m.role === "admin"))
          }
          onDelete={() => { removeMember(editingMember.id, editingMember.email, currentUser.email); }}
        />
      )}
      {photoViewer && (
        <AvatarLightbox
          member={photoViewer.member}
          onClose={() => setPhotoViewer(null)}
          canChange={photoViewer.canChange}
          onChange={() => {
            const member = photoViewer.member;
            setPhotoViewer(null);
            setEditingMember(member);
          }}
        />
      )}

      {/* Integration Detail Panel */}
      {activeIntegration && (
        <IntegrationDetailPanel
          integration={INTEGRATIONS.find((i) => i.id === activeIntegration)!}
          onClose={() => setActiveIntegration(null)}
        />
      )}
    </div>
  );
}

// ─── Integration Data ───

const INTEGRATIONS = [
  {
    id: "supabase",
    name: "Supabase",
    desc: "Persistent storage, auth, real-time sync",
    icon: Database,
    iconBg: "bg-emerald-50 dark:bg-emerald-500/10",
    iconColor: "text-emerald-600 dark:text-emerald-400",
    status: "connected" as const,
    details: {
      version: "supabase-js v2",
      region: "Asia-Pacific (Singapore)",
      features: ["PostgreSQL Database", "Row Level Security", "Realtime Subscriptions", "Auth & Magic Links", "Storage Buckets"],
      tables: ["posts", "team_members", "post_audit_logs", "media_assets", "brand_playbook"],
      lastSync: "Live — real-time enabled",
    },
  },
  {
    id: "google-drive",
    name: "Google Drive",
    desc: "Video/image cloud storage (60TB)",
    icon: HardDrive,
    iconBg: "bg-blue-50 dark:bg-blue-500/10",
    iconColor: "text-blue-600 dark:text-blue-400",
    status: "connected" as const,
    details: {
      version: "Drive API v3",
      region: "Google Workspace — Super Admin",
      features: ["Resumable Uploads", "Video Streaming Proxy", "Automatic Subfolders", "Public File Serving", "60TB Storage"],
      tables: ["thumbnails/", "raw-files/", "media-library/"],
      lastSync: "On-demand — per upload",
    },
  },
  {
    id: "n8n",
    name: "n8n Auto-Publish",
    desc: "Automated social media posting engine",
    icon: Zap,
    iconBg: "bg-orange-50 dark:bg-orange-500/10",
    iconColor: "text-orange-600 dark:text-orange-400",
    status: "connected" as const,
    details: {
      version: "n8n Community Edition 2.3.6",
      region: "n8n.casemovers.com",
      features: ["Scheduled Auto-Post (5-min cron)", "Platform-Specific Caption Formatting", "Master File Download via Drive Proxy", "Supabase Status Update → Posted", "Audit Log Auto-Entry"],
      tables: ["[WIP] - The Reach Auto-Post Engine"],
      lastSync: "Active — workflow deployed",
    },
  },
  {
    id: "api-keys",
    name: "API Keys",
    desc: "Custom integrations and automations",
    icon: Key,
    iconBg: "bg-amber-50 dark:bg-amber-500/10",
    iconColor: "text-amber-600 dark:text-amber-400",
    status: "connected" as const,
    details: {
      version: "REST + Service Account",
      region: "Vercel Edge Network",
      features: ["Team Invite API", "Mention Notifications", "Drive Upload Sessions", "Audit Log Queries"],
      tables: ["/api/team/invite", "/api/drive/upload", "/api/drive/stream", "/api/notifications/mention"],
      lastSync: "Active — 4 endpoints",
    },
  },
];

// ─── Integration Detail Panel ───

function IntegrationDetailPanel({ integration, onClose }: { integration: (typeof INTEGRATIONS)[number]; onClose: () => void }) {
  const connected = integration.status === "connected";
  const Icon = integration.icon;
  const [showContactPrompt, setShowContactPrompt] = useState(false);

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 bg-black/30 dark:bg-black/60 z-50 transition-opacity" />
      <div className="fixed right-0 top-0 bottom-0 w-full max-w-[440px] z-50 bg-white dark:bg-[#0e0e11] border-l border-gray-200 dark:border-white/[0.08] shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-100 dark:border-white/[0.06] shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${integration.iconBg}`}>
                <Icon className={`w-5 h-5 ${integration.iconColor}`} />
              </div>
              <div>
                <h2 className="text-[15px] font-bold text-gray-900 dark:text-white">{integration.name}</h2>
                <p className="text-[11px] text-gray-400 mt-0.5">{integration.desc}</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-white/[0.06] text-gray-400 cursor-pointer transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Status card */}
          <div className={`rounded-xl border p-4 ${connected ? "bg-emerald-50/50 dark:bg-emerald-500/5 border-emerald-200 dark:border-emerald-500/20" : "bg-gray-50 dark:bg-white/[0.02] border-gray-200 dark:border-white/[0.08]"}`}>
            <div className="flex items-center gap-3">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${connected ? "bg-emerald-100 dark:bg-emerald-500/20" : "bg-gray-100 dark:bg-white/[0.06]"}`}>
                {connected ? <CheckCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /> : <ClockIcon className="w-4 h-4 text-gray-400" />}
              </div>
              <div className="flex-1">
                <p className={`text-[13px] font-semibold ${connected ? "text-emerald-700 dark:text-emerald-400" : "text-gray-500"}`}>
                  {connected ? "Connected & Active" : "Coming Soon"}
                </p>
                <p className="text-[11px] text-gray-400 mt-0.5">{integration.details.lastSync}</p>
              </div>
              {connected && <Activity className="w-4 h-4 text-emerald-500 animate-pulse" />}
            </div>
          </div>

          {/* Technical details */}
          <div className="space-y-3">
            <h3 className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em]">Configuration</h3>
            <div className="bg-gray-50 dark:bg-white/[0.02] rounded-xl border border-gray-100 dark:border-white/[0.06] divide-y divide-gray-100 dark:divide-white/[0.04]">
              <div className="flex items-center justify-between px-4 py-2.5">
                <span className="text-[11px] text-gray-500">SDK / API</span>
                <span className="text-[11px] font-medium text-gray-700 dark:text-gray-300">{integration.details.version}</span>
              </div>
              <div className="flex items-center justify-between px-4 py-2.5">
                <span className="text-[11px] text-gray-500">Region</span>
                <span className="text-[11px] font-medium text-gray-700 dark:text-gray-300">{integration.details.region}</span>
              </div>
            </div>
          </div>

          {/* Features */}
          <div className="space-y-3">
            <h3 className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em]">Features</h3>
            <div className="space-y-1.5">
              {integration.details.features.map((feature) => (
                <div key={feature} className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-gray-50 dark:bg-white/[0.02] border border-gray-100 dark:border-white/[0.04]">
                  <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${connected ? "bg-emerald-500" : "bg-gray-300 dark:bg-gray-600"}`} />
                  <span className="text-[11px] text-gray-600 dark:text-gray-400 font-medium">{feature}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Resources / endpoints */}
          {integration.details.tables.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em]">
                {integration.id === "api-keys" ? "Endpoints" : integration.id === "google-drive" ? "Folders" : "Resources"}
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {integration.details.tables.map((t) => (
                  <span key={t} className="text-[10px] font-mono px-2.5 py-1 rounded-md bg-slate-100 dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.06] text-gray-600 dark:text-gray-400">{t}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 dark:border-white/[0.06] shrink-0">
          {connected ? (
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-gray-400">Managed by workspace admin</span>
              <Button size="sm" variant="outline" onClick={() => setShowContactPrompt(true)} className="h-8 rounded-lg text-[11px] border-gray-200 text-gray-500 hover:bg-gray-50 dark:border-white/[0.08] dark:hover:bg-white/[0.04] cursor-pointer">Manage</Button>
            </div>
          ) : (
            <Button size="sm" onClick={() => setShowContactPrompt(true)} className="w-full h-9 rounded-lg bg-gray-900 dark:bg-white dark:text-gray-900 text-white text-[12px] cursor-pointer">
              Enable Integration
            </Button>
          )}
        </div>

        {/* Contact prompt */}
        {showContactPrompt && (
          <>
            <div onClick={() => setShowContactPrompt(false)} className="fixed inset-0 bg-black/40 z-[70]" />
            <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[70] w-full max-w-[360px] bg-white dark:bg-[#151518] rounded-2xl border border-gray-200 dark:border-white/[0.08] shadow-2xl p-6 text-center animate-in fade-in zoom-in-95 duration-200">
              <div className="w-12 h-12 mx-auto rounded-xl bg-orange-50 dark:bg-orange-500/10 flex items-center justify-center mb-4">
                <ShieldIcon className="w-6 h-6 text-orange-500" />
              </div>
              <h3 className="text-[15px] font-bold text-gray-900 dark:text-white">Admin Action Required</h3>
              <p className="text-[12px] text-gray-400 mt-2 leading-relaxed">Integration changes require developer access. Reach out to make modifications to this connection.</p>
              <div className="flex flex-col gap-2 mt-5">
                <a href="https://wa.me/639154954549" target="_blank" rel="noopener noreferrer" className="w-full h-10 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-[13px] font-semibold flex items-center justify-center gap-2 cursor-pointer transition-colors shadow-sm">
                  <ExternalLink className="w-3.5 h-3.5" />Contact Developer
                </a>
                <button onClick={() => setShowContactPrompt(false)} className="w-full h-10 rounded-lg border border-gray-200 dark:border-white/[0.08] text-gray-500 dark:text-gray-400 text-[12px] font-medium hover:bg-gray-50 dark:hover:bg-white/[0.03] cursor-pointer transition-colors">Cancel</button>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return formatDateShort(dateStr);
}

const CONTENT_ACTIONS = ["stage_change", "revision_submitted", "revision_requested", "content_edited", "asset_replaced", "card_viewed", "comment_added", "vault_updated", "raw_file_uploaded", "title_edited", "license_uploaded"];
const SYSTEM_ACTIONS = ["invite_sent", "role_changed", "member_removed", "settings_changed"];
const MENTION_ACTIONS = ["mention_sent"];

type AuditCategory = "all" | "content" | "system" | "mentions";

function AuditLogTab({ auditLogs, auditLoading, setAuditLogs, setAuditLoading }: {
  auditLogs: AuditEntry[]; auditLoading: boolean;
  setAuditLogs: (logs: AuditEntry[]) => void; setAuditLoading: (v: boolean) => void;
}) {
  const { cards, selectCard } = usePipeline();
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  const [category, setCategory] = useState<AuditCategory>("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    setAuditLoading(true);
    fetchAllAuditLogs(500).then((logs) => { setAuditLogs(logs); setAuditLoading(false); });
  }, [setAuditLoading, setAuditLogs]);

  const actionMeta = useMemo<Record<string, { label: string; color: string; icon: "content" | "system" | "mention" }>>(() => ({
    stage_change: { label: "Stage Changed", color: "bg-blue-500", icon: "content" },
    revision_submitted: { label: "Fix Submitted", color: "bg-violet-500", icon: "content" },
    revision_requested: { label: "Revision Requested", color: "bg-red-500", icon: "content" },
    content_edited: { label: "Content Edited", color: "bg-amber-500", icon: "content" },
    asset_replaced: { label: "Asset Replaced", color: "bg-emerald-500", icon: "content" },
    card_viewed: { label: "Viewed", color: "bg-gray-300 dark:bg-gray-600", icon: "content" },
    comment_added: { label: "Comment Added", color: "bg-orange-500", icon: "content" },
    vault_updated: { label: "Vault Updated", color: "bg-sky-500", icon: "content" },
    raw_file_uploaded: { label: "File Uploaded", color: "bg-purple-500", icon: "content" },
    title_edited: { label: "Title Edited", color: "bg-amber-500", icon: "content" },
    license_uploaded: { label: "License Uploaded", color: "bg-teal-500", icon: "content" },
    mention_sent: { label: "Mention Sent", color: "bg-pink-500", icon: "mention" },
    invite_sent: { label: "Invite Sent", color: "bg-indigo-500", icon: "system" },
    role_changed: { label: "Role Changed", color: "bg-cyan-500", icon: "system" },
    member_removed: { label: "Member Removed", color: "bg-red-600", icon: "system" },
    settings_changed: { label: "Settings Changed", color: "bg-gray-500", icon: "system" },
  }), []);

  const filteredLogs = useMemo(() => {
    let logs = [...auditLogs];

    // Category filter
    if (category === "content") logs = logs.filter((l) => CONTENT_ACTIONS.includes(l.action_type));
    else if (category === "system") logs = logs.filter((l) => SYSTEM_ACTIONS.includes(l.action_type));
    else if (category === "mentions") logs = logs.filter((l) => MENTION_ACTIONS.includes(l.action_type));

    // Text search
    if (search.trim()) {
      const q = search.toLowerCase();
      logs = logs.filter((l) =>
        l.user_name.toLowerCase().includes(q) ||
        (l.details || "").toLowerCase().includes(q) ||
        (actionMeta[l.action_type]?.label || l.action_type).toLowerCase().includes(q)
      );
    }

    // Sort
    if (sortOrder === "oldest") logs.reverse();
    return logs;
  }, [auditLogs, sortOrder, category, search, actionMeta]);

  // Category counts
  const counts = useMemo(() => ({
    all: auditLogs.length,
    content: auditLogs.filter((l) => CONTENT_ACTIONS.includes(l.action_type)).length,
    system: auditLogs.filter((l) => SYSTEM_ACTIONS.includes(l.action_type)).length,
    mentions: auditLogs.filter((l) => MENTION_ACTIONS.includes(l.action_type)).length,
  }), [auditLogs]);

  const handleLogClick = (postId: string) => {
    const card = cards.find((c) => c.id === postId);
    if (card) selectCard(card);
  };

  if (auditLoading) {
    return <div className="flex items-center justify-center py-16"><div className="w-5 h-5 border-2 border-gray-300 border-t-orange-500 rounded-full animate-spin" /></div>;
  }

  if (auditLogs.length === 0) {
    return (
      <div className="text-center py-16">
        <History className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
        <p className="text-[14px] font-medium text-gray-400">No audit activity yet</p>
        <p className="text-[12px] text-gray-300 dark:text-gray-600 mt-1">Actions across all cards will appear here</p>
      </div>
    );
  }

  const categories: { id: AuditCategory; label: string; icon: React.ReactNode }[] = [
    { id: "all", label: "All Events", icon: <Filter className="w-3 h-3" /> },
    { id: "content", label: "Content", icon: <FileTextIcon className="w-3 h-3" /> },
    { id: "system", label: "System & Team", icon: <ShieldIcon className="w-3 h-3" /> },
    { id: "mentions", label: "Mentions", icon: <AtSign className="w-3 h-3" /> },
  ];

  return (
    <div className="space-y-3">
      {/* ── Premium Filter Bar ── */}
      <div className="bg-white dark:bg-[#151518] rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-sm p-3 space-y-3">
        {/* Category tabs */}
        <div className="flex items-center gap-1">
          {categories.map((cat) => (
            <button key={cat.id} onClick={() => setCategory(cat.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all cursor-pointer ${
                category === cat.id
                  ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900 shadow-sm"
                  : "text-gray-400 hover:text-gray-600 hover:bg-gray-50 dark:hover:bg-white/[0.04]"
              }`}>
              {cat.icon}
              {cat.label}
              <span className={`text-[9px] tabular-nums px-1.5 py-0.5 rounded-full ${
                category === cat.id
                  ? "bg-white/20 dark:bg-gray-900/20"
                  : "bg-gray-100 dark:bg-white/[0.06]"
              }`}>{counts[cat.id]}</span>
            </button>
          ))}
        </div>

        {/* Search + sort row */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-300 dark:text-gray-600" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by user, action, or detail..."
              className="w-full h-8 pl-9 pr-3 rounded-lg bg-gray-50 dark:bg-white/[0.03] border border-gray-100 dark:border-white/[0.06] text-[11px] text-gray-700 dark:text-gray-300 placeholder:text-gray-300 dark:placeholder:text-gray-600 outline-none focus:border-orange-300 dark:focus:border-orange-500/30 focus:ring-1 focus:ring-orange-100 dark:focus:ring-orange-500/10 transition-all"
            />
          </div>
          <button onClick={() => setSortOrder((p) => p === "newest" ? "oldest" : "newest")} className="h-8 px-3 rounded-lg bg-gray-50 dark:bg-white/[0.03] border border-gray-100 dark:border-white/[0.06] text-[11px] text-gray-500 dark:text-gray-400 cursor-pointer hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors flex items-center gap-1.5 shrink-0">
            <ArrowUpDown className="w-3 h-3" />
            {sortOrder === "newest" ? "Newest" : "Oldest"}
          </button>
          <span className="text-[10px] text-gray-300 dark:text-gray-600 tabular-nums shrink-0">{filteredLogs.length}</span>
        </div>
      </div>

      {/* ── Timeline Feed ── */}
      <div className="bg-white dark:bg-[#151518] rounded-2xl border border-gray-100 dark:border-white/[0.06] overflow-hidden shadow-sm">
        {filteredLogs.map((entry, i) => {
          const meta = actionMeta[entry.action_type] || { label: entry.action_type, color: "bg-gray-400", icon: "content" as const };
          const ago = timeAgo(entry.created_at);
          const fullDate = formatDateTime(entry.created_at);

          // Category icon styling
          const iconBg = meta.icon === "system"
            ? "bg-violet-50 dark:bg-violet-500/10 text-violet-500"
            : meta.icon === "mention"
            ? "bg-orange-50 dark:bg-orange-500/10 text-orange-500"
            : "bg-blue-50 dark:bg-blue-500/10 text-blue-500";

          const IconEl = meta.icon === "system" ? ShieldIcon : meta.icon === "mention" ? AtSign : FileTextIcon;

          return (
            <button
              key={entry.id}
              onClick={() => handleLogClick(entry.post_id)}
              className={`w-full flex items-start gap-3 px-4 py-3.5 hover:bg-slate-50/80 dark:hover:bg-white/[0.02] transition-colors cursor-pointer text-left group ${i > 0 ? "border-t border-gray-50 dark:border-white/[0.03]" : ""}`}
            >
              {/* Category icon */}
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${iconBg}`}>
                <IconEl className="w-3.5 h-3.5" />
              </div>

              <div className="flex-1 min-w-0">
                {/* Top line: user + action badge + time */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[12px] font-semibold text-gray-800 dark:text-gray-200">{entry.user_name}</span>
                  <span className={`inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full text-white ${meta.color}`}>
                    {meta.label}
                  </span>
                  <span className="text-[10px] text-gray-300 dark:text-gray-600 ml-auto shrink-0 tabular-nums" title={fullDate}>{ago}</span>
                </div>

                {/* Detail line */}
                {entry.details && (
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1 leading-relaxed line-clamp-2">{entry.details}</p>
                )}
              </div>

              <ArrowUpRight className="w-3.5 h-3.5 text-gray-200 dark:text-gray-700 group-hover:text-orange-400 shrink-0 mt-1.5 transition-colors" />
            </button>
          );
        })}
        {filteredLogs.length === 0 && (
          <div className="py-12 text-center">
            <Search className="w-6 h-6 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
            <p className="text-[12px] text-gray-400">No entries match your filters</p>
            <button onClick={() => { setSearch(""); setCategory("all"); }} className="text-[11px] text-orange-500 hover:underline cursor-pointer mt-1">Clear filters</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Publishing Queue Panel ───
//
// Admin-only view of v_publish_queue (migration 0026). Surfaces every job
// worth watching: pending (waiting for scheduled_at), claimed (in-flight),
// partial (some platforms succeeded), failed (all-platform failure / DLQ).
// Force Retry resets the row to clean pending so the next n8n claim picks
// it up.
interface PublishQueueRow {
  job_id: string;
  state: string;
  scheduled_at: string;
  next_retry_at: string | null;
  attempts: number;
  last_error: string | null;
  worker_id: string | null;
  claim_expires_at: string | null;
  post_id: string;
  title: string | null;
  stage: string;
  platforms: string[] | null;
  scheduled_timezone: string | null;
  posted_at: string | null;
  posted_urls: Record<string, string> | null;
  overdue_by: string | null;
  claim_stuck: boolean;
}

function publishQueueStateBadge(state: string): { label: string; cls: string } {
  switch (state) {
    case "pending":  return { label: "Pending",  cls: "bg-gray-100 text-gray-600 dark:bg-white/[0.06] dark:text-gray-300" };
    case "claimed":  return { label: "In Flight", cls: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300" };
    case "running":  return { label: "Running",  cls: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300" };
    case "partial":  return { label: "Partial",  cls: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" };
    case "failed":   return { label: "Failed",   cls: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300" };
    default:         return { label: state,      cls: "bg-gray-100 text-gray-600 dark:bg-white/[0.06] dark:text-gray-300" };
  }
}

function formatClientError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const record = err as Record<string, unknown>;
    const message = typeof record.message === "string" ? record.message : null;
    const details = typeof record.details === "string" ? record.details : null;
    const hint = typeof record.hint === "string" ? record.hint : null;
    const code = typeof record.code === "string" ? `code ${record.code}` : null;
    const parts = [message, details, hint, code].filter(Boolean);
    if (parts.length > 0) return parts.join(" — ");
    try {
      return JSON.stringify(record);
    } catch {
      return Object.prototype.toString.call(err);
    }
  }
  return String(err);
}

function PublishQueuePanel({ addToast }: { addToast: (msg: string, kind?: "info" | "success" | "error" | "warning") => void }) {
  const [rows, setRows] = useState<PublishQueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const { data, error } = await supabase
        .from("v_publish_queue")
        .select("*")
        .limit(50);
      if (error) throw error;
      setRows((data || []) as PublishQueueRow[]);
    } catch (err) {
      if (!silent) addToast(`Couldn't load queue: ${formatClientError(err)}`, "error");
    } finally {
      if (!silent) setRefreshing(false);
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const id = setInterval(() => { void load(true); }, 30_000);
    return () => clearInterval(id);
  }, [load]);

  const retry = useCallback(async (jobId: string) => {
    setRetrying(jobId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
      const res = await fetch(`/api/admin/publish-jobs/${jobId}/retry`, { method: "POST", headers });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      addToast("Job reset to pending. n8n will pick it up on the next tick.", "success");
      await load(true);
    } catch (err) {
      addToast(`Retry failed: ${formatClientError(err)}`, "error");
    } finally {
      setRetrying(null);
    }
  }, [addToast, load]);

  if (loading) {
    return <div className="px-4 py-4 flex items-center gap-2 text-[12px] text-gray-400"><Loader2 className="w-3 h-3 animate-spin" /> Loading queue…</div>;
  }

  if (rows.length === 0) {
    return (
      <div className="px-4 py-4 text-[12px] text-gray-500 dark:text-gray-400 flex items-center gap-2">
        <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
        Queue is empty. All approved posts are published or scheduled.
      </div>
    );
  }

  return (
    <div className="px-4 py-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-gray-500 dark:text-gray-400">{rows.length} job{rows.length === 1 ? "" : "s"} in flight or scheduled.</p>
        <button onClick={() => void load(false)} disabled={refreshing} className="text-[10px] text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 inline-flex items-center gap-1 disabled:opacity-40">
          {refreshing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          Refresh
        </button>
      </div>

      <div className="space-y-2">
        {rows.map((row) => {
          const badge = publishQueueStateBadge(row.state);
          const scheduledStr = new Date(row.scheduled_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
          const overdueMs = (() => {
            const t = new Date(row.scheduled_at).getTime();
            return Date.now() - t;
          })();
          const overdue = row.state === "pending" && overdueMs > 5 * 60_000;
          const canRetry = row.state === "failed" || row.state === "partial" || row.claim_stuck;

          return (
            <div key={row.job_id} className="px-3 py-2.5 rounded-lg border border-gray-100 dark:border-white/[0.06] bg-white dark:bg-[#0c0d11]">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wider ${badge.cls}`}>{badge.label}</span>
                    {row.claim_stuck && <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wider bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">Stuck</span>}
                    {overdue && <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wider bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">Overdue</span>}
                    <span className="text-[10px] text-gray-400 ml-0.5">Attempt {row.attempts}/3</span>
                  </div>
                  <p className="text-[12px] font-medium text-gray-800 dark:text-gray-200 mt-1 line-clamp-1">{row.title || row.post_id}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    <Clock className="w-2.5 h-2.5 inline -mt-0.5 mr-1" />
                    {scheduledStr}
                    {row.scheduled_timezone && <span className="text-gray-300 dark:text-gray-600 ml-1">({row.scheduled_timezone})</span>}
                  </p>
                  {row.last_error && (
                    <p className="text-[10px] text-rose-600 dark:text-rose-400 mt-1 font-mono line-clamp-2 break-all">{row.last_error}</p>
                  )}
                </div>
                {canRetry && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void retry(row.job_id)}
                    disabled={retrying === row.job_id}
                    className="h-7 text-[10px] px-2.5 cursor-pointer shrink-0"
                  >
                    {retrying === row.job_id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}
                    Force retry
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h2 className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em] flex items-center gap-1.5">{icon}{title}</h2>
      <div className="bg-white dark:bg-[#151518] rounded-2xl border border-gray-100 dark:border-white/[0.06] overflow-hidden shadow-sm">{children}</div>
    </div>
  );
}

function SettingRow({ icon: Icon, label, desc, children }: { icon: LucideIcon; label: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-50 dark:border-white/[0.03] last:border-0">
      <div className="w-7 h-7 rounded-lg bg-gray-50 dark:bg-white/[0.04] border border-gray-100 dark:border-white/[0.06] flex items-center justify-center shrink-0">
        <Icon className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
      </div>
      <div className="flex-1 min-w-0"><p className="text-[12px] font-medium text-gray-700 dark:text-gray-300">{label}</p><p className="text-[10px] text-gray-400 mt-0.5">{desc}</p></div>
      {children}
    </div>
  );
}

function Toggle({
  defaultOn = false,
  disabled = false,
  checked,
  onChange,
  ariaLabel,
}: {
  defaultOn?: boolean;
  disabled?: boolean;
  checked?: boolean;
  onChange?: (enabled: boolean) => void;
  ariaLabel?: string;
}) {
  const [internalOn, setInternalOn] = useState(defaultOn);
  const on = checked ?? internalOn;
  // UX-013: when disabled the toggle is inert — flipping it would not persist
  // anything, so it must not appear interactive.
  const toggle = () => {
    const next = !on;
    if (checked === undefined) setInternalOn(next);
    onChange?.(next);
  };
  return (
    <button
      type="button"
      onClick={disabled ? undefined : toggle}
      disabled={disabled}
      aria-disabled={disabled}
      aria-pressed={on}
      aria-label={ariaLabel}
      className={`w-9 h-5 rounded-full transition-colors shrink-0 ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"} ${on ? "bg-blue-500" : "bg-gray-200 dark:bg-white/[0.1]"}`}
    >
      <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${on ? "translate-x-[18px]" : "translate-x-[2px]"}`} />
    </button>
  );
}
