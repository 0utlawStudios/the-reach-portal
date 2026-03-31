"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabaseClient";
import { AvatarCropModal } from "@/components/avatar-crop-modal";
import { useTheme } from "@/lib/theme-context";
import { useTeam, UserRole, TeamMember } from "@/lib/team-context";
import { useToast } from "@/lib/toast-context";
import { useAuth } from "@/lib/auth-context";
import { usePresence, PresenceStatus } from "@/lib/use-presence";
import { usePipeline } from "@/lib/pipeline-context";
import { ThemeSelector } from "@/components/theme-selector";
import { logAudit, fetchAllAuditLogs, AuditEntry } from "@/lib/audit";
import { History, ArrowUpRight, SlidersHorizontal, Search, FileText as FileTextIcon, Shield as ShieldIcon, AtSign, ArrowUpDown, Filter, ChevronRight, CheckCircle, Activity, Clock as ClockIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlatformIcon } from "@/components/platform-icons";
import {
  Database, Key, Bell, Palette, HardDrive, ExternalLink, Globe, Clock,
  Shield, Download, Sun, Moon, Mail,
  Smartphone, Calendar, BarChart3, Zap, Link2, Webhook, FileText,
  UserPlus, ShieldCheck, Pencil, Eye, Crown, X, Send, Megaphone, Code, Users, Settings as SettingsIcon,
  Camera, Save, Upload, Trash2,
} from "lucide-react";

const roleConfig: Record<UserRole, { label: string; icon: React.ReactNode; color: string }> = {
  superadmin: { label: "Super Admin", icon: <Crown className="w-3 h-3" />, color: "text-amber-600 bg-amber-50 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20" },
  admin: { label: "Admin", icon: <ShieldCheck className="w-3 h-3" />, color: "text-blue-600 bg-blue-50 border-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20" },
  developer: { label: "Developer", icon: <Code className="w-3 h-3" />, color: "text-emerald-600 bg-emerald-50 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20" },
  specialist: { label: "Social Media Specialist", icon: <Megaphone className="w-3 h-3" />, color: "text-purple-600 bg-purple-50 border-purple-200 dark:bg-purple-500/10 dark:text-purple-400 dark:border-purple-500/20" },
  editor: { label: "Editor", icon: <Pencil className="w-3 h-3" />, color: "text-green-600 bg-green-50 border-green-200 dark:bg-green-500/10 dark:text-green-400 dark:border-green-500/20" },
  viewer: { label: "Viewer", icon: <Eye className="w-3 h-3" />, color: "text-gray-500 bg-gray-50 border-gray-200 dark:bg-white/[0.04] dark:text-gray-400 dark:border-white/[0.08]" },
  technician: { label: "Field Tech", icon: <ShieldCheck className="w-3 h-3" />, color: "text-sky-600 bg-sky-50 border-sky-200 dark:bg-sky-500/10 dark:text-sky-400 dark:border-sky-500/20" },
};

// ─── Edit Profile Modal ───
function EditProfileModal({ member, onClose, onDelete, canDelete }: { member: TeamMember; onClose: () => void; onDelete?: () => void; canDelete?: boolean }) {
  const { updateMember } = useTeam();
  const { addToast } = useToast();
  const { currentUser, updateCurrentUserAvatar } = useAuth();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [name, setName] = useState(member.name);
  const [email, setEmail] = useState(member.email);
  const [phone, setPhone] = useState(member.phone || "");
  const [role, setRole] = useState<UserRole>(member.role);
  const [avatarUrl, setAvatarUrl] = useState(member.avatar || "");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [secondaryRoles, setSecondaryRoles] = useState<string[]>(
    member.secondaryRole ? member.secondaryRole.split(" / ") : []
  );

  const availableSecondary = ["Approver", "Developer", "Lead Tech", "Social Media Specialist", "Content Creator", "Project Manager"];
  const unusedRoles = availableSecondary.filter((r) => !secondaryRoles.includes(r));

  const addSecondaryRole = (r: string) => setSecondaryRoles((prev) => [...prev, r]);
  const removeSecondaryRole = (r: string) => setSecondaryRoles((prev) => prev.filter((x) => x !== r));

  // Avatar crop flow
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);

  const handleAvatarSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
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

    if (useDb) {
      const path = `${member.id}-${Date.now()}.jpg`;
      const { error } = await supabase.storage.from("avatars").upload(path, croppedBlob, { upsert: true, contentType: "image/jpeg" });
      if (!error) {
        const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path);
        setAvatarUrl(urlData.publicUrl);
        addToast("Photo cropped & uploaded", "success");
      } else {
        addToast("Upload failed — check Supabase storage bucket", "error");
      }
    } else {
      setAvatarUrl(URL.createObjectURL(croppedBlob));
      addToast("Photo cropped (local only)", "info");
    }
    setUploading(false);
  };

  const handleSave = () => {
    const roleChanged = role !== member.role;
    updateMember(member.id, { name, email, phone: phone || undefined, role, avatar: avatarUrl || undefined, secondaryRole: secondaryRoles.length > 0 ? secondaryRoles.join(" / ") : undefined });
    if (member.email === currentUser.email) {
      updateCurrentUserAvatar(avatarUrl || undefined);
    }
    if (roleChanged) {
      logAudit("system", currentUser.name, "role_changed", `Changed ${name}'s role from ${member.role} to ${role}`);
    }
    addToast(`Profile updated for ${name}`, "success");
    onClose();
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
                {avatarUrl ? (
                  <img src={avatarUrl} alt={name} className="w-20 h-20 rounded-full object-cover" />
                ) : (
                  <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-[22px] font-bold text-white">
                    {name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                  </div>
                )}
                <button onClick={() => fileInputRef.current?.click()} className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer">
                  {uploading ? (
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Camera className="w-5 h-5 text-white" />
                  )}
                </button>
                <button onClick={() => fileInputRef.current?.click()} className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-blue-600 border-2 border-white dark:border-[#151518] flex items-center justify-center cursor-pointer hover:bg-blue-700 transition-colors">
                  <Upload className="w-3 h-3 text-white" />
                </button>
              </div>
            </div>

            {/* Name */}
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.08em]">Full Name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="h-9 bg-gray-50 dark:bg-white/[0.04] border-gray-200 dark:border-white/[0.08] rounded-lg text-[13px] text-gray-800 dark:text-gray-200" />
            </div>

            {/* Email */}
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.08em]">Email</label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-9 bg-gray-50 dark:bg-white/[0.04] border-gray-200 dark:border-white/[0.08] rounded-lg text-[13px] text-gray-800 dark:text-gray-200" />
            </div>

            {/* Phone */}
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.08em]">Phone / WhatsApp</label>
              <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 234 567 8900" className="h-9 bg-gray-50 dark:bg-white/[0.04] border-gray-200 dark:border-white/[0.08] rounded-lg text-[13px] text-gray-800 dark:text-gray-200 font-mono" />
            </div>

            {/* Role */}
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.08em]">Role</label>
              {member.role === "superadmin" ? (
                <div className="h-9 px-3 flex items-center rounded-lg bg-amber-50 dark:bg-amber-500/5 border border-amber-200 dark:border-amber-500/20 text-[13px] text-amber-700 dark:text-amber-400 font-medium">
                  <Crown className="w-3.5 h-3.5 mr-2" />Owner — cannot be reassigned
                </div>
              ) : (
                <select value={role} onChange={(e) => setRole(e.target.value as UserRole)} className="w-full h-9 px-3 rounded-lg bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] text-[13px] text-gray-700 dark:text-gray-300 outline-none cursor-pointer">
                  {Object.entries(roleConfig).filter(([key]) => key !== "superadmin").map(([key, conf]) => (
                    <option key={key} value={key}>{conf.label}</option>
                  ))}
                </select>
              )}
            </div>

            {/* Additional Roles */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.08em]">Additional Roles</label>
              {secondaryRoles.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {secondaryRoles.map((r) => {
                    const badgeColor =
                      r === "Developer" ? "text-emerald-600 bg-emerald-50 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400" :
                      r === "Approver" ? "text-violet-600 bg-violet-50 border-violet-200 dark:bg-violet-500/10 dark:text-violet-400" :
                      r === "Lead Tech" ? "text-sky-600 bg-sky-50 border-sky-200 dark:bg-sky-500/10 dark:text-sky-400" :
                      "text-gray-600 bg-gray-50 border-gray-200 dark:bg-white/[0.04] dark:text-gray-400";
                    return (
                      <span key={r} className={`inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-lg border ${badgeColor}`}>
                        {r}
                        <button onClick={() => removeSecondaryRole(r)} className="ml-0.5 text-gray-400 hover:text-red-500 cursor-pointer transition-colors"><X className="w-3 h-3" /></button>
                      </span>
                    );
                  })}
                </div>
              )}
              {unusedRoles.length > 0 && (
                <select
                  onChange={(e) => { if (e.target.value) { addSecondaryRole(e.target.value); e.target.value = ""; } }}
                  defaultValue=""
                  className="w-full h-9 px-3 rounded-lg bg-gray-50 dark:bg-white/[0.04] border border-dashed border-gray-300 dark:border-white/[0.1] text-[12px] text-gray-500 dark:text-gray-400 outline-none cursor-pointer"
                >
                  <option value="" disabled>+ Add another role...</option>
                  {unusedRoles.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-2">
              <Button variant="outline" onClick={onClose} className="flex-1 h-9 rounded-lg text-[12px]">Cancel</Button>
              <Button onClick={handleSave} className="flex-1 h-9 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-[12px] shadow-sm">
                <Save className="w-3.5 h-3.5 mr-1.5" />Save Changes
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
    </>
  );
}

function PresenceDot({ status }: { status: PresenceStatus }) {
  const colors: Record<PresenceStatus, string> = {
    online: "bg-emerald-500 shadow-emerald-500/40",
    idle: "bg-amber-400 shadow-amber-400/40",
    offline: "bg-gray-300 dark:bg-gray-600",
  };
  return (
    <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white dark:border-[#151518] ${colors[status]} ${status === "online" ? "shadow-sm" : ""}`} title={status} />
  );
}

function ConnectedBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-semibold uppercase tracking-wider bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-500/20">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />Connected
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
  const { members, removeMember, pendingRequests, refreshPendingRequests } = useTeam();
  const { currentUser } = useAuth();
  const { addToast } = useToast();
  const currentMember = members.find((m) => m.email === currentUser.email);
  const isAdmin = currentMember?.role === "superadmin" || currentMember?.role === "developer" || currentMember?.role === "admin";
  const isSuperadmin = currentMember?.role === "superadmin";
  const canViewAudit = isAdmin || currentMember?.secondaryRole?.includes("Approver") || currentMember?.secondaryRole?.includes("Creative Director");
  const { getStatus } = usePresence(currentUser.email);
  const [activeTab, setActiveTab] = useState<"general" | "team" | "audit" | "themes">("general");
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<UserRole>("viewer");
  const [inviting, setInviting] = useState(false);
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null);
  const [activeIntegration, setActiveIntegration] = useState<string | null>(null);
  const [approving, setApproving] = useState<string | null>(null);

  const handleApprove = async (reqId: string, action: "approve" | "reject", role = "viewer") => {
    setApproving(reqId);
    try {
      const res = await fetch("/api/team/approve-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: reqId, action, role, reviewedBy: currentUser.email }),
      });
      const data = await res.json();
      if (res.ok) {
        refreshPendingRequests();
        addToast(action === "approve" ? `Approved — branded invite sent` : "Request rejected", action === "approve" ? "success" : "info");
      } else {
        addToast(data.error || "Action failed", "error");
      }
    } catch { addToast("Network error", "error"); }
    setApproving(null);
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim() || !inviteName.trim() || inviting) return;
    setInviting(true);
    try {
      const res = await fetch("/api/team/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
      addToast(`Secure invite link sent to ${inviteEmail.trim()}`, "success");
      logAudit("system", currentUser.name, "invite_sent", `Invited ${inviteName.trim()} (${inviteEmail.trim()}) as ${inviteRole}`);
      setInviteEmail(""); setInviteName(""); setShowInvite(false);
    } catch {
      addToast("Network error — invite not sent", "error");
    } finally {
      setInviting(false);
    }
  };

  return (
    <div className="p-5 max-w-[760px] mx-auto w-full space-y-4">
      <div>
        <h1 className="text-[18px] font-bold text-gray-900 dark:text-white tracking-[-0.02em]">Settings</h1>
        <p className="text-[13px] text-gray-400 mt-0.5">Workspace configuration, team, and integrations</p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-gray-100 dark:border-white/[0.06]">
        {[
          { id: "general" as const, label: "General", icon: <SettingsIcon className="w-3.5 h-3.5" /> },
          { id: "team" as const, label: "Team Members", icon: <Users className="w-3.5 h-3.5" />, badge: pendingRequests.length > 0 ? pendingRequests.length : undefined },
          { id: "themes" as const, label: "Themes", icon: <Palette className="w-3.5 h-3.5" /> },
          ...(canViewAudit ? [{ id: "audit" as const, label: "Audit Logs", icon: <FileText className="w-3.5 h-3.5" /> }] : []),
        ].map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-[12px] font-medium border-b-2 -mb-px transition-colors cursor-pointer ${activeTab === tab.id ? "border-blue-600 text-blue-700 dark:text-blue-400" : "border-transparent text-gray-400 hover:text-gray-600"}`}>
            {tab.icon}{tab.label}
            {tab.id === "team" && <span className="text-[9px] bg-gray-100 dark:bg-white/[0.06] text-gray-500 px-1.5 rounded-full">{members.length}</span>}
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
              <select className="h-8 px-3 rounded-lg bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] text-[11px] text-gray-600 dark:text-gray-300 outline-none cursor-pointer">
                <option>Pacific Time (PT)</option><option>Mountain Time (MT)</option><option>Central Time (CT)</option><option>Eastern Time (ET)</option><option>UTC</option>
              </select>
            </SettingRow>
            <SettingRow icon={Calendar} label="Week starts on" desc="First day of the week in calendar">
              <select className="h-8 px-3 rounded-lg bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] text-[11px] text-gray-600 dark:text-gray-300 outline-none cursor-pointer">
                <option>Monday</option><option>Sunday</option>
              </select>
            </SettingRow>
          </Section>

          <Section title="Connected Accounts" icon={<Link2 className="w-3.5 h-3.5 text-emerald-500" />}>
            {(["facebook", "instagram", "x", "linkedin", "youtube", "tiktok"] as const).map((p) => (
              <div key={p} className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-50 dark:border-white/[0.03] last:border-0">
                <span className="text-gray-600 dark:text-gray-400"><PlatformIcon platform={p} className="w-4.5 h-4.5" /></span>
                <span className="flex-1 text-[12px] font-medium text-gray-700 dark:text-gray-300 capitalize">{p === "x" ? "X (Twitter)" : p}</span>
                <Button size="sm" variant="outline" onClick={() => addToast(`${p === "x" ? "X" : p.charAt(0).toUpperCase() + p.slice(1)} integration coming soon`, "info")} className="h-7 text-[10px] rounded-lg px-3 cursor-pointer">Connect</Button>
              </div>
            ))}
          </Section>

          <Section title="Publishing" icon={<Zap className="w-3.5 h-3.5 text-amber-500" />}>
            <SettingRow icon={Clock} label="Auto-publish" desc="Publish approved posts at scheduled time"><Toggle /></SettingRow>
            <SettingRow icon={BarChart3} label="Analytics tracking" desc="Track engagement after publishing"><Toggle defaultOn /></SettingRow>
            <SettingRow icon={FileText} label="Hashtag sets" desc="Reusable hashtag groups"><Button size="sm" variant="outline" onClick={() => addToast("Hashtag set management coming soon", "info")} className="h-7 text-[10px] rounded-lg px-3 cursor-pointer">Manage</Button></SettingRow>
            <SettingRow icon={Smartphone} label="Caption templates" desc="Saved caption formats"><Button size="sm" variant="outline" onClick={() => addToast("Caption templates coming soon", "info")} className="h-7 text-[10px] rounded-lg px-3 cursor-pointer">Manage</Button></SettingRow>
          </Section>

          <Section title="Notifications" icon={<Bell className="w-3.5 h-3.5 text-violet-500" />}>
            <SettingRow icon={Mail} label="Email notifications" desc="Alerts for approvals and status changes"><Toggle defaultOn /></SettingRow>
            <SettingRow icon={Bell} label="Post reminders" desc="Notify 1 hour before scheduled post"><Toggle defaultOn /></SettingRow>
            <SettingRow icon={Shield} label="Team activity" desc="When team members move posts or @mention"><Toggle /></SettingRow>
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
            <Section title="Data" icon={<Shield className="w-3.5 h-3.5 text-rose-500" />}>
              <SettingRow icon={Download} label="Export data" desc="Download posts, media, analytics as CSV"><Button size="sm" variant="outline" onClick={() => addToast("Data export coming soon", "info")} className="h-7 text-[10px] rounded-lg px-3 cursor-pointer">Export</Button></SettingRow>
            </Section>
          )}
        </div>
      ) : (
        /* Team tab */
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[13px] text-gray-500 dark:text-gray-400">{members.length} members with workspace access</p>
            <Button size="sm" onClick={() => setShowInvite(!showInvite)} className="h-8 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-[11px] font-medium cursor-pointer shadow-sm">
              <UserPlus className="w-3.5 h-3.5 mr-1.5" />Invite
            </Button>
          </div>

          {showInvite && (
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
                  <option value="viewer">Viewer</option><option value="editor">Editor</option><option value="specialist">Specialist</option><option value="technician">Field Tech</option><option value="admin">Admin</option>
                </select>
                <Button type="submit" size="sm" disabled={inviting || !inviteEmail.trim() || !inviteName.trim()} className="h-9 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-[12px] px-5 cursor-pointer shadow-sm disabled:opacity-40">
                  {inviting ? <span className="flex items-center gap-1.5"><span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />Sending...</span> : <><Send className="w-3 h-3 mr-1.5" />Send Invite</>}
                </Button>
              </div>
            </form>
          )}

          {/* Pending access requests — visible to ALL, approve/reject buttons for superadmin ONLY */}
          {pendingRequests.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-[0.08em] flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                Pending Access Requests ({pendingRequests.length})
              </h3>
              <div className="bg-white dark:bg-[#151518] rounded-2xl border border-amber-200/60 dark:border-amber-500/20 overflow-hidden shadow-sm">
                {pendingRequests.map((req, i) => (
                  <div key={req.id} className={`px-4 py-3 ${i > 0 ? "border-t border-amber-100 dark:border-amber-500/10" : ""}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-gray-800 dark:text-gray-200">{req.name}</p>
                        <p className="text-[11px] text-gray-400 mt-0.5">{req.email}{req.phone ? ` · ${req.phone}` : ""}</p>
                        {req.company && <p className="text-[10px] text-gray-400 mt-0.5">{req.company}</p>}
                        {req.reason && <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 italic">&ldquo;{req.reason}&rdquo;</p>}
                        <p className="text-[9px] text-gray-300 dark:text-gray-600 mt-1">{new Date(req.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p>
                      </div>
                      {/* Only superadmin sees approve/reject buttons */}
                      {isSuperadmin && (
                        <div className="flex gap-1.5 shrink-0">
                          <button disabled={approving === req.id} onClick={() => handleApprove(req.id, "reject")}
                            className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-white/[0.08] text-[10px] font-medium text-gray-500 hover:text-red-500 hover:border-red-200 dark:hover:border-red-500/20 transition-colors cursor-pointer disabled:opacity-40">
                            Reject
                          </button>
                          <button disabled={approving === req.id} onClick={() => handleApprove(req.id, "approve", "viewer")}
                            className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-[10px] font-medium shadow-sm cursor-pointer transition-colors disabled:opacity-40">
                            {approving === req.id ? "..." : "Approve"}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Members list */}
          <div className="bg-white dark:bg-[#151518] rounded-2xl border border-gray-100 dark:border-white/[0.06] overflow-hidden shadow-sm">
            {members.map((member, i) => {
              const role = roleConfig[member.role];
              return (
                <button key={member.id} onClick={() => setEditingMember(member)}
                  className={`w-full flex items-start gap-3 px-4 py-3.5 hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors cursor-pointer text-left ${i > 0 ? "border-t border-gray-50 dark:border-white/[0.03]" : ""}`}>
                  <div className="relative shrink-0 mt-0.5">
                    {member.avatar ? (
                      <img src={member.avatar} alt={member.name} className="w-9 h-9 rounded-full object-cover" />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-[11px] font-bold text-white">
                        {member.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                      </div>
                    )}
                    <PresenceDot status={getStatus(member.email)} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className="text-[13px] font-medium text-gray-800 dark:text-gray-200">{member.name}</p>
                      <Pencil className="w-3.5 h-3.5 text-gray-300 shrink-0 ml-2" />
                    </div>
                    <p className="text-[11px] text-gray-400 mt-0.5">{member.email}{member.phone ? ` · ${member.phone}` : ""}</p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      <Badge variant="outline" className={`text-[10px] h-5 px-2 border ${role?.color || "text-gray-500 bg-gray-50 border-gray-200"}`}>{role?.icon}<span className="ml-1">{role?.label || member.role}</span></Badge>
                      {member.secondaryRole && member.secondaryRole.split(" / ").map((badge) => {
                        const badgeColor =
                          badge === "Developer" ? "text-emerald-600 bg-emerald-50 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20" :
                          badge === "Approver" ? "text-violet-600 bg-violet-50 border-violet-200 dark:bg-violet-500/10 dark:text-violet-400 dark:border-violet-500/20" :
                          badge === "Lead Tech" ? "text-sky-600 bg-sky-50 border-sky-200 dark:bg-sky-500/10 dark:text-sky-400 dark:border-sky-500/20" :
                          "text-gray-500 bg-gray-50 border-gray-200 dark:bg-white/[0.04] dark:text-gray-400 dark:border-white/[0.08]";
                        return <Badge key={badge} variant="outline" className={`text-[10px] h-5 px-2 border ${badgeColor}`}>{badge}</Badge>;
                      })}
                      {member.status === "pending" && (
                        <Badge variant="outline" className="text-[10px] h-5 px-2 border text-amber-600 bg-amber-50 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20 animate-pulse">
                          <Mail className="w-2.5 h-2.5 mr-1" />Pending Invite
                        </Badge>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Edit Profile Modal */}
      {editingMember && (
        <EditProfileModal
          member={editingMember}
          onClose={() => setEditingMember(null)}
          canDelete={
            editingMember.role !== "superadmin" &&
            (currentUser.email !== editingMember.email) &&
            members.some((m) => m.email === currentUser.email && (m.role === "superadmin" || m.role === "admin"))
          }
          onDelete={() => { removeMember(editingMember.id); logAudit("system", currentUser.name, "member_removed", `Removed ${editingMember.name} (${editingMember.email})`); addToast(`${editingMember.name} removed from team`, "success"); }}
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
    id: "notion",
    name: "Notion",
    desc: "Sync content ideas and briefs",
    icon: ExternalLink,
    iconBg: "bg-gray-50 dark:bg-white/[0.04]",
    iconColor: "text-gray-500 dark:text-gray-400",
    status: "coming_soon" as const,
    details: {
      version: "Notion API v1",
      region: "—",
      features: ["Content Brief Sync", "Idea Database Import", "Two-way Sync", "Template Library"],
      tables: [],
      lastSync: "Not connected",
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
      tables: ["[WIP] - Ten80Ten Auto-Post Engine"],
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
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
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
  }, []);

  const actionMeta: Record<string, { label: string; color: string; icon: "content" | "system" | "mention" }> = {
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
  };

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
  }, [auditLogs, sortOrder, category, search]);

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
          const fullDate = new Date(entry.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

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

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h2 className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em] flex items-center gap-1.5">{icon}{title}</h2>
      <div className="bg-white dark:bg-[#151518] rounded-2xl border border-gray-100 dark:border-white/[0.06] overflow-hidden shadow-sm">{children}</div>
    </div>
  );
}

function SettingRow({ icon: Icon, label, desc, children }: { icon: any; label: string; desc: string; children: React.ReactNode }) {
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

function Toggle({ defaultOn = false }: { defaultOn?: boolean }) {
  const [on, setOn] = useState(defaultOn);
  return (
    <button onClick={() => setOn(!on)} className={`w-9 h-5 rounded-full transition-colors cursor-pointer shrink-0 ${on ? "bg-blue-500" : "bg-gray-200 dark:bg-white/[0.1]"}`}>
      <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${on ? "translate-x-[18px]" : "translate-x-[2px]"}`} />
    </button>
  );
}
