"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useTheme } from "@/lib/theme-context";
import { useTeam, UserRole, TeamMember } from "@/lib/team-context";
import { useToast } from "@/lib/toast-context";
import { useAuth } from "@/lib/auth-context";
import { usePipeline } from "@/lib/pipeline-context";
import { fetchAllAuditLogs, AuditEntry } from "@/lib/audit";
import { History, ArrowUpRight, SlidersHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlatformIcon } from "@/components/platform-icons";
import {
  Database, Key, Bell, Palette, HardDrive, ExternalLink, Globe, Clock,
  Shield, Download, Sun, Moon, Mail,
  Smartphone, Calendar, BarChart3, Zap, Link2, Webhook, FileText,
  UserPlus, ShieldCheck, Pencil, Eye, Crown, X, Send, Megaphone, Code, Users, Settings as SettingsIcon,
  Camera, Save, Upload,
} from "lucide-react";

const roleConfig: Record<UserRole, { label: string; icon: React.ReactNode; color: string }> = {
  owner: { label: "Owner", icon: <Crown className="w-3 h-3" />, color: "text-amber-600 bg-amber-50 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20" },
  admin: { label: "Admin", icon: <ShieldCheck className="w-3 h-3" />, color: "text-blue-600 bg-blue-50 border-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20" },
  developer: { label: "Developer", icon: <Code className="w-3 h-3" />, color: "text-emerald-600 bg-emerald-50 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20" },
  specialist: { label: "Social Media Specialist", icon: <Megaphone className="w-3 h-3" />, color: "text-purple-600 bg-purple-50 border-purple-200 dark:bg-purple-500/10 dark:text-purple-400 dark:border-purple-500/20" },
  editor: { label: "Editor", icon: <Pencil className="w-3 h-3" />, color: "text-green-600 bg-green-50 border-green-200 dark:bg-green-500/10 dark:text-green-400 dark:border-green-500/20" },
  viewer: { label: "Viewer", icon: <Eye className="w-3 h-3" />, color: "text-gray-500 bg-gray-50 border-gray-200 dark:bg-white/[0.04] dark:text-gray-400 dark:border-white/[0.08]" },
  technician: { label: "Field Tech", icon: <ShieldCheck className="w-3 h-3" />, color: "text-sky-600 bg-sky-50 border-sky-200 dark:bg-sky-500/10 dark:text-sky-400 dark:border-sky-500/20" },
};

// ─── Edit Profile Modal ───
function EditProfileModal({ member, onClose }: { member: TeamMember; onClose: () => void }) {
  const { updateMember } = useTeam();
  const { addToast } = useToast();
  const { currentUser, updateCurrentUserAvatar } = useAuth();
  const [name, setName] = useState(member.name);
  const [email, setEmail] = useState(member.email);
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

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);

    const useDb = !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

    if (useDb) {
      const ext = file.name.split(".").pop();
      const path = `${member.id}-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
      if (!error) {
        const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path);
        setAvatarUrl(urlData.publicUrl);
        addToast("Photo uploaded", "success");
      } else {
        addToast("Upload failed — check Supabase storage bucket", "error");
      }
    } else {
      // Fallback: use blob URL (local only)
      setAvatarUrl(URL.createObjectURL(file));
      addToast("Photo set (local only — connect Supabase for sync)", "info");
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSave = () => {
    updateMember(member.id, { name, email, role, avatar: avatarUrl || undefined, secondaryRole: secondaryRoles.length > 0 ? secondaryRoles.join(" / ") : undefined });
    // Sync avatar to auth context if editing the current logged-in user
    if (member.email === currentUser.email) {
      updateCurrentUserAvatar(avatarUrl || undefined);
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
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" />
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
              <Input value={name} onChange={(e) => setName(e.target.value)} className="h-9 bg-gray-50 dark:bg-white/[0.04] border-gray-200 dark:border-white/[0.08] rounded-lg text-[13px]" />
            </div>

            {/* Email */}
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.08em]">Email</label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-9 bg-gray-50 dark:bg-white/[0.04] border-gray-200 dark:border-white/[0.08] rounded-lg text-[13px]" />
            </div>

            {/* Role */}
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.08em]">Role</label>
              <select value={role} onChange={(e) => setRole(e.target.value as UserRole)} className="w-full h-9 px-3 rounded-lg bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] text-[13px] text-gray-700 dark:text-gray-300 outline-none cursor-pointer">
                {Object.entries(roleConfig).map(([key, conf]) => (
                  <option key={key} value={key}>{conf.label}</option>
                ))}
              </select>
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
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Coming Soon Badge ───
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
  const { members, inviteMember, removeMember } = useTeam();
  const { addToast } = useToast();
  const [activeTab, setActiveTab] = useState<"general" | "team" | "audit">("general");
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<UserRole>("viewer");
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null);

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim() || !inviteName.trim()) return;
    inviteMember(inviteEmail.trim(), inviteName.trim(), inviteRole);
    addToast(`Invitation sent to ${inviteName.trim()}`, "success");
    setInviteEmail(""); setInviteName(""); setShowInvite(false);
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
          { id: "team" as const, label: "Team Members", icon: <Users className="w-3.5 h-3.5" /> },
          { id: "audit" as const, label: "Audit Logs", icon: <FileText className="w-3.5 h-3.5" /> },
        ].map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-[12px] font-medium border-b-2 -mb-px transition-colors cursor-pointer ${activeTab === tab.id ? "border-blue-600 text-blue-700 dark:text-blue-400" : "border-transparent text-gray-400 hover:text-gray-600"}`}>
            {tab.icon}{tab.label}
            {tab.id === "team" && <span className="text-[9px] bg-gray-100 dark:bg-white/[0.06] text-gray-500 px-1.5 rounded-full">{members.length}</span>}
          </button>
        ))}
      </div>

      {activeTab === "audit" ? (
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
                <Button size="sm" variant="outline" className="h-7 text-[10px] rounded-lg px-3 cursor-pointer">Connect</Button>
              </div>
            ))}
          </Section>

          <Section title="Publishing" icon={<Zap className="w-3.5 h-3.5 text-amber-500" />}>
            <SettingRow icon={Clock} label="Auto-publish" desc="Publish approved posts at scheduled time"><Toggle /></SettingRow>
            <SettingRow icon={BarChart3} label="Analytics tracking" desc="Track engagement after publishing"><Toggle defaultOn /></SettingRow>
            <SettingRow icon={FileText} label="Hashtag sets" desc="Reusable hashtag groups"><Button size="sm" variant="outline" className="h-7 text-[10px] rounded-lg px-3 cursor-pointer">Manage</Button></SettingRow>
            <SettingRow icon={Smartphone} label="Caption templates" desc="Saved caption formats"><Button size="sm" variant="outline" className="h-7 text-[10px] rounded-lg px-3 cursor-pointer">Manage</Button></SettingRow>
          </Section>

          <Section title="Notifications" icon={<Bell className="w-3.5 h-3.5 text-violet-500" />}>
            <SettingRow icon={Mail} label="Email notifications" desc="Alerts for approvals and status changes"><Toggle defaultOn /></SettingRow>
            <SettingRow icon={Bell} label="Post reminders" desc="Notify 1 hour before scheduled post"><Toggle defaultOn /></SettingRow>
            <SettingRow icon={Shield} label="Team activity" desc="When team members move posts or @mention"><Toggle /></SettingRow>
          </Section>

          <Section title="Integrations" icon={<Webhook className="w-3.5 h-3.5 text-sky-500" />}>
            <SettingRow icon={Database} label="Supabase" desc="Persistent storage, auth, real-time sync"><ComingSoonBadge /></SettingRow>
            <SettingRow icon={HardDrive} label="Google Drive" desc="60TB video/image cloud storage"><ComingSoonBadge /></SettingRow>
            <SettingRow icon={ExternalLink} label="Notion" desc="Sync content ideas and briefs"><ComingSoonBadge /></SettingRow>
            <SettingRow icon={Key} label="API Keys" desc="Custom integrations and automations"><ComingSoonBadge /></SettingRow>
          </Section>

          <Section title="Data" icon={<Shield className="w-3.5 h-3.5 text-rose-500" />}>
            <SettingRow icon={Download} label="Export data" desc="Download posts, media, analytics as CSV"><Button size="sm" variant="outline" className="h-7 text-[10px] rounded-lg px-3 cursor-pointer">Export</Button></SettingRow>
          </Section>
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
            <form onSubmit={handleInvite} className="bg-white dark:bg-[#151518] rounded-xl border border-gray-200 dark:border-white/[0.08] p-4 space-y-2 shadow-sm">
              <div className="flex items-center justify-between">
                <h3 className="text-[12px] font-semibold text-gray-600 dark:text-gray-300">Invite New Member</h3>
                <button type="button" onClick={() => setShowInvite(false)} className="text-gray-400 hover:text-gray-600 cursor-pointer"><X className="w-4 h-4" /></button>
              </div>
              <Input placeholder="Full name" value={inviteName} onChange={(e) => setInviteName(e.target.value)} className="h-9 bg-gray-50 dark:bg-white/[0.04] border-gray-200 dark:border-white/[0.08] rounded-lg text-[12px]" autoFocus />
              <Input type="email" placeholder="email@example.com" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} className="h-9 bg-gray-50 dark:bg-white/[0.04] border-gray-200 dark:border-white/[0.08] rounded-lg text-[12px]" />
              <div className="flex gap-2">
                <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as UserRole)} className="h-9 px-3 rounded-lg bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] text-[12px] text-gray-600 dark:text-gray-300 outline-none cursor-pointer flex-1">
                  <option value="viewer">Viewer</option><option value="editor">Editor</option><option value="specialist">Specialist</option><option value="technician">Field Tech</option><option value="admin">Admin</option>
                </select>
                <Button type="submit" size="sm" disabled={!inviteEmail.trim() || !inviteName.trim()} className="h-9 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[12px] px-4 cursor-pointer">
                  <Send className="w-3 h-3 mr-1.5" />Send
                </Button>
              </div>
            </form>
          )}

          {/* Members list */}
          <div className="bg-white dark:bg-[#151518] rounded-2xl border border-gray-100 dark:border-white/[0.06] overflow-hidden shadow-sm">
            {members.map((member, i) => {
              const role = roleConfig[member.role];
              return (
                <button key={member.id} onClick={() => setEditingMember(member)}
                  className={`w-full flex items-start gap-3 px-4 py-3.5 hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors cursor-pointer text-left ${i > 0 ? "border-t border-gray-50 dark:border-white/[0.03]" : ""}`}>
                  {member.avatar ? (
                    <img src={member.avatar} alt={member.name} className="w-9 h-9 rounded-full object-cover shrink-0 mt-0.5" />
                  ) : (
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-[11px] font-bold text-white shrink-0 mt-0.5">
                    {member.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                  </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className="text-[13px] font-medium text-gray-800 dark:text-gray-200">{member.name}</p>
                      <Pencil className="w-3.5 h-3.5 text-gray-300 shrink-0 ml-2" />
                    </div>
                    <p className="text-[11px] text-gray-400 mt-0.5">{member.email}</p>
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
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Edit Profile Modal */}
      {editingMember && <EditProfileModal member={editingMember} onClose={() => setEditingMember(null)} />}
    </div>
  );
}

function AuditLogTab({ auditLogs, auditLoading, setAuditLogs, setAuditLoading }: {
  auditLogs: AuditEntry[]; auditLoading: boolean;
  setAuditLogs: (logs: AuditEntry[]) => void; setAuditLoading: (v: boolean) => void;
}) {
  const { cards, selectCard } = usePipeline();
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  const [filterAction, setFilterAction] = useState<string>("all");

  useEffect(() => {
    setAuditLoading(true);
    fetchAllAuditLogs(200).then((logs) => { setAuditLogs(logs); setAuditLoading(false); });
  }, []);

  const actionColors: Record<string, string> = {
    stage_change: "bg-blue-500", revision_submitted: "bg-violet-500", revision_requested: "bg-red-500",
    content_edited: "bg-amber-500", asset_replaced: "bg-emerald-500", card_viewed: "bg-gray-400",
    comment_added: "bg-orange-500", vault_updated: "bg-sky-500", raw_file_uploaded: "bg-purple-500", title_edited: "bg-amber-500",
  };
  const actionLabels: Record<string, string> = {
    stage_change: "Stage Changed", revision_submitted: "Fix Submitted", revision_requested: "Revision Requested",
    content_edited: "Content Edited", asset_replaced: "Asset Replaced", card_viewed: "Viewed",
    comment_added: "Comment Added", vault_updated: "Vault Updated", raw_file_uploaded: "File Uploaded", title_edited: "Title Edited",
  };

  const FILTER_OPTIONS = [
    { value: "all", label: "All Actions" },
    { value: "no_views", label: "Hide Views" },
    { value: "stage_change", label: "Stage Changes" },
    { value: "revision_submitted", label: "Fixes Submitted" },
    { value: "revision_requested", label: "Revisions Requested" },
    { value: "content_edited", label: "Content Edits" },
    { value: "comment_added", label: "Comments" },
  ];

  const filteredLogs = useMemo(() => {
    let logs = [...auditLogs];
    if (filterAction === "no_views") logs = logs.filter((l) => l.action_type !== "card_viewed");
    else if (filterAction !== "all") logs = logs.filter((l) => l.action_type === filterAction);
    if (sortOrder === "oldest") logs.reverse();
    return logs;
  }, [auditLogs, sortOrder, filterAction]);

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

  return (
    <div className="space-y-3">
      {/* Controls bar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <select value={filterAction} onChange={(e) => setFilterAction(e.target.value)} className="h-8 px-3 rounded-lg bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] text-[11px] text-gray-600 dark:text-gray-300 outline-none cursor-pointer">
            {FILTER_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
          <button onClick={() => setSortOrder((p) => p === "newest" ? "oldest" : "newest")} className="h-8 px-3 rounded-lg bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] text-[11px] text-gray-600 dark:text-gray-300 cursor-pointer hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors">
            {sortOrder === "newest" ? "Newest First" : "Oldest First"}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-gray-400 tabular-nums">{filteredLogs.length} entries</span>
          <Badge variant="outline" className="text-[9px] h-5 px-2 border-gray-200 dark:border-white/[0.08] text-gray-400">Read-Only</Badge>
        </div>
      </div>
      {/* Log list */}
      <div className="bg-white dark:bg-[#151518] rounded-2xl border border-gray-100 dark:border-white/[0.06] overflow-hidden shadow-sm">
        {filteredLogs.map((entry, i) => {
          const date = new Date(entry.created_at);
          const timeStr = date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
          const dotColor = actionColors[entry.action_type] || "bg-gray-400";
          const label = actionLabels[entry.action_type] || entry.action_type;
          return (
            <button
              key={entry.id}
              onClick={() => handleLogClick(entry.post_id)}
              className={`w-full flex items-start gap-3 px-4 py-3 hover:bg-orange-50/50 dark:hover:bg-orange-500/[0.03] transition-colors cursor-pointer text-left ${i > 0 ? "border-t border-gray-50 dark:border-white/[0.03]" : ""}`}
            >
              <div className={`w-2.5 h-2.5 rounded-full ${dotColor} shrink-0 mt-1.5`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-semibold text-gray-800 dark:text-gray-200">{entry.user_name}</span>
                  <span className="text-[10px] text-gray-400">{timeStr}</span>
                </div>
                <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400 mt-0.5">{label}</p>
                {entry.details && <p className="text-[11px] text-gray-400 mt-0.5 truncate">{entry.details}</p>}
              </div>
              <ArrowUpRight className="w-3.5 h-3.5 text-gray-300 dark:text-gray-600 shrink-0 mt-1" />
            </button>
          );
        })}
        {filteredLogs.length === 0 && (
          <div className="py-8 text-center"><p className="text-[12px] text-gray-400">No entries match this filter</p></div>
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
