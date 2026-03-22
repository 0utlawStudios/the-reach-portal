"use client";

import { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef, ReactNode } from "react";
import { loadState, saveState } from "./persistence";
import { supabase } from "./supabaseClient";

export type UserRole = "owner" | "admin" | "developer" | "editor" | "viewer" | "specialist" | "technician";
export type InviteStatus = "active" | "pending";

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  secondaryRole?: string;
  status: InviteStatus;
  joinedAt: string;
  avatar?: string;
}

interface TeamContextType {
  members: TeamMember[];
  inviteMember: (email: string, name: string, role: UserRole) => void;
  removeMember: (id: string) => void;
  updateMember: (id: string, updates: Partial<TeamMember>) => void;
}

const TeamContext = createContext<TeamContextType | null>(null);
const STORAGE_KEY = "team_members";

function isSupabaseConfigured(): boolean {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

function dbToMember(row: any): TeamMember {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    secondaryRole: row.secondary_role || undefined,
    status: row.status,
    joinedAt: row.joined_at || row.created_at?.split("T")[0],
    avatar: row.avatar_url || undefined,
  };
}

const DEFAULT_MEMBERS: TeamMember[] = [
  { id: "1", name: "Aldridge Dagos", email: "aldridge@ten80ten.com", role: "owner", secondaryRole: "Approver / Developer", status: "active", joinedAt: "2025-01-01" },
  { id: "2", name: "Christer Umali", email: "christer@ten80ten.com", role: "admin", secondaryRole: "Approver", status: "active", joinedAt: "2025-02-01" },
  { id: "3", name: "Alex Nicholson", email: "alex@ten80ten.com", role: "admin", secondaryRole: "Approver", status: "active", joinedAt: "2025-03-01" },
  { id: "4", name: "Carlo Navarro", email: "carlo@ten80ten.com", role: "specialist", secondaryRole: "Creative Director / Approver", status: "active", joinedAt: "2025-04-01" },
  { id: "5", name: "Muaaz Saifi", email: "muaaz.ten80ten@gmail.com", role: "specialist", secondaryRole: "Social Media Specialist", status: "active", joinedAt: "2025-05-01" },
];

export function TeamProvider({ children }: { children: ReactNode }) {
  const [members, setMembers] = useState<TeamMember[]>(DEFAULT_MEMBERS);
  const hydrated = useRef(false);
  const useDb = isSupabaseConfigured();

  useEffect(() => {
    async function load() {
      if (useDb) {
        try {
          const { data, error } = await supabase.from("team_members").select("*").order("joined_at");
          if (!error && data && data.length > 0) {
            setMembers(data.map(dbToMember));
          } else {
            setMembers(loadState(STORAGE_KEY, DEFAULT_MEMBERS));
          }
        } catch {
          setMembers(loadState(STORAGE_KEY, DEFAULT_MEMBERS));
        }
      } else {
        setMembers(loadState(STORAGE_KEY, DEFAULT_MEMBERS));
      }
      hydrated.current = true;
    }
    load();
  }, [useDb]);

  // ─── Realtime subscription for team changes ───
  useEffect(() => {
    if (!useDb) return;
    const channel = supabase
      .channel("team-realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "team_members" }, (payload) => {
        const member = dbToMember(payload.new);
        setMembers((prev) => prev.some((m) => m.id === member.id) ? prev : [...prev, member]);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "team_members" }, (payload) => {
        const updated = dbToMember(payload.new);
        setMembers((prev) => prev.map((m) => m.id === updated.id ? updated : m));
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "team_members" }, (payload) => {
        const deletedId = (payload.old as any)?.id;
        if (deletedId) setMembers((prev) => prev.filter((m) => m.id !== deletedId));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [useDb]);

  useEffect(() => {
    if (hydrated.current) saveState(STORAGE_KEY, members);
  }, [members]);

  const inviteMember = useCallback((email: string, name: string, role: UserRole) => {
    const tempId = Date.now().toString();
    const member: TeamMember = { id: tempId, name, email, role, status: "pending", joinedAt: new Date().toISOString().split("T")[0] };
    setMembers((prev) => [...prev, member]);
    if (useDb) {
      supabase.from("team_members").insert({ name, email, role, status: "pending" }).select().single().then(({ data }) => {
        if (data) setMembers((prev) => prev.map((m) => m.id === tempId ? { ...m, id: data.id } : m));
      });
    }
  }, [useDb]);

  const removeMember = useCallback((id: string) => {
    setMembers((prev) => prev.filter((m) => m.id !== id));
    if (useDb) { supabase.from("team_members").delete().eq("id", id).then(() => {}); }
  }, [useDb]);

  const updateMember = useCallback((id: string, updates: Partial<TeamMember>) => {
    setMembers((prev) => prev.map((m) => m.id === id ? { ...m, ...updates } : m));
    if (useDb) {
      const dbUpdates: any = {};
      if (updates.name !== undefined) dbUpdates.name = updates.name;
      if (updates.email !== undefined) dbUpdates.email = updates.email;
      if (updates.role !== undefined) dbUpdates.role = updates.role;
      if (updates.secondaryRole !== undefined) dbUpdates.secondary_role = updates.secondaryRole;
      if (updates.status !== undefined) dbUpdates.status = updates.status;
      if (updates.avatar !== undefined) dbUpdates.avatar_url = updates.avatar;
      supabase.from("team_members").update(dbUpdates).eq("id", id).then(() => {});
    }
  }, [useDb]);

  const value = useMemo(
    () => ({ members, inviteMember, removeMember, updateMember }),
    [members, inviteMember, removeMember, updateMember]
  );

  return <TeamContext.Provider value={value}>{children}</TeamContext.Provider>;
}

export function useTeam() {
  const ctx = useContext(TeamContext);
  if (!ctx) throw new Error("useTeam must be used within TeamProvider");
  return ctx;
}
