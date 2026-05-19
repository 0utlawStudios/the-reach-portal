"use client";

import { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef, ReactNode } from "react";
import { loadState, saveState } from "./persistence";
import { supabase } from "./supabaseClient";
import { useToast } from "./toast-context";

export type UserRole = "superadmin" | "admin" | "approver" | "creative_director" | "social_media_specialist" | "video_editor" | "graphic_designer";
export type InviteStatus = "active" | "pending";

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: UserRole;
  secondaryRole?: string;
  status: InviteStatus;
  joinedAt: string;
  updatedAt?: string;
  avatar?: string;
}

export interface SignupRequest {
  id: string;
  name: string;
  email: string;
  phone?: string;
  company?: string;
  reason?: string;
  status: "pending" | "approved" | "rejected";
  reviewed_by?: string;
  reviewed_at?: string;
  created_at: string;
}

interface TeamContextType {
  members: TeamMember[];
  pendingRequests: SignupRequest[];
  inviteMember: (email: string, name: string, role: UserRole) => void;
  removeMember: (id: string, email: string, requestedBy: string) => void;
  updateMember: (id: string, updates: Partial<TeamMember>) => void;
  refreshPendingRequests: () => void;
}

const TeamContext = createContext<TeamContextType | null>(null);
const STORAGE_KEY = "team_members";

type TeamMemberRow = {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  role: UserRole;
  secondary_role?: string | null;
  status: InviteStatus;
  joined_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  avatar_url?: string | null;
};

type TeamMemberUpdate = {
  name?: string;
  email?: string;
  role?: UserRole;
  secondary_role?: string;
  status?: InviteStatus;
  avatar_url?: string;
  phone?: string;
};

function isSupabaseConfigured(): boolean {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

function dbToMember(row: TeamMemberRow): TeamMember {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    secondaryRole: row.secondary_role || undefined,
    status: row.status,
    joinedAt: row.joined_at || row.created_at?.split("T")[0] || new Date().toISOString().split("T")[0],
    updatedAt: row.updated_at || undefined,
    avatar: row.avatar_url || undefined,
    phone: row.phone || undefined,
  };
}

const DEFAULT_MEMBERS: TeamMember[] = [];

export function TeamProvider({ children }: { children: ReactNode }) {
  const { addToast } = useToast();
  const [members, setMembers] = useState<TeamMember[]>(DEFAULT_MEMBERS);
  const [pendingRequests, setPendingRequests] = useState<SignupRequest[]>([]);
  const hydrated = useRef(false);
  // PERF-015: debounce localStorage writes so a burst of realtime updates
  // (e.g. five member rows arriving back-to-back) collapses into one save.
  const persistTimeoutRef = useRef<number | null>(null);
  const useDb = isSupabaseConfigured();

  useEffect(() => {
    async function load() {
      if (useDb) {
        try {
          const { data, error } = await supabase.from("team_members").select("*").order("joined_at");
          if (!error && data) {
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

  // Load pending signup requests
  const refreshPendingRequests = useCallback(() => {
    if (!useDb) return;
    supabase
      .from("signup_requests")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (data) setPendingRequests(data);
      });
  }, [useDb]);

  useEffect(() => {
    refreshPendingRequests();
  }, [refreshPendingRequests]);

  // ─── Realtime subscription for team changes ───
  useEffect(() => {
    if (!useDb) return;
    const channel = supabase
      .channel("team-realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "team_members" }, (payload) => {
        const member = dbToMember(payload.new as TeamMemberRow);
        setMembers((prev) => prev.some((m) => m.id === member.id) ? prev : [...prev, member]);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "team_members" }, (payload) => {
        const updated = dbToMember(payload.new as TeamMemberRow);
        setMembers((prev) => prev.map((m) => m.id === updated.id ? updated : m));
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "team_members" }, (payload) => {
        const deletedId = (payload.old as Partial<TeamMemberRow>).id;
        if (deletedId) setMembers((prev) => prev.filter((m) => m.id !== deletedId));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [useDb]);

  // PERF-015: 500ms debounce — saveState fires synchronous JSON.stringify on
  // the whole team list. A realtime sync burst (5+ INSERT/UPDATE events in
  // succession) used to trigger 5+ stringifies. One save at the tail suffices.
  useEffect(() => {
    if (!hydrated.current) return;
    if (persistTimeoutRef.current) window.clearTimeout(persistTimeoutRef.current);
    persistTimeoutRef.current = window.setTimeout(() => {
      saveState(STORAGE_KEY, members);
      persistTimeoutRef.current = null;
    }, 500);
    return () => {
      if (persistTimeoutRef.current) {
        window.clearTimeout(persistTimeoutRef.current);
        persistTimeoutRef.current = null;
      }
    };
  }, [members]);

  const inviteMember = useCallback((email: string, name: string, role: UserRole) => {
    const tempId = Date.now().toString();
    const member: TeamMember = { id: tempId, name, email, role, status: "pending", joinedAt: new Date().toISOString().split("T")[0] };
    setMembers((prev) => [...prev, member]);
    if (useDb) {
      // DATA-007: mirror the pipeline-context.createCard rollback pattern.
      // On insert failure (RLS, duplicate email, etc.), strip the optimistic
      // row and toast the error so the UI never carries a phantom invite.
      supabase.from("team_members").insert({ name, email, role, status: "pending" }).select().single().then(({ data, error }) => {
        if (error) {
          console.error("[team] inviteMember sync failed:", error.message);
          setMembers((prev) => prev.filter((m) => m.id !== tempId));
          addToast(`Invite failed: ${error.message}. Member was not added.`, "error");
          return;
        }
        if (data) setMembers((prev) => prev.map((m) => m.id === tempId ? { ...m, id: data.id } : m));
      });
    }
  }, [useDb, addToast]);

  const removeMember = useCallback((id: string, email: string, requestedBy: string) => {
    setMembers((prev) => prev.filter((m) => m.id !== id));
    if (useDb) {
      // Use the API route to delete both team_members AND auth user
      supabase.auth.getSession().then(({ data: { session } }) => {
        const headers: HeadersInit = { "Content-Type": "application/json" };
        if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
        fetch("/api/team/remove-member", {
          method: "POST",
          headers,
          body: JSON.stringify({ memberId: id, memberEmail: email, requestedBy }),
        }).catch(() => {});
      }).catch(() => {});
    }
  }, [useDb]);

  const updateMember = useCallback((id: string, updates: Partial<TeamMember>) => {
    setMembers((prev) => prev.map((m) => m.id === id ? { ...m, ...updates } : m));
    if (useDb) {
      const dbUpdates: TeamMemberUpdate = {};
      if (updates.name !== undefined) dbUpdates.name = updates.name;
      if (updates.email !== undefined) dbUpdates.email = updates.email;
      if (updates.role !== undefined) dbUpdates.role = updates.role;
      if (updates.secondaryRole !== undefined) dbUpdates.secondary_role = updates.secondaryRole;
      if (updates.status !== undefined) dbUpdates.status = updates.status;
      if (updates.avatar !== undefined) dbUpdates.avatar_url = updates.avatar;
      if (updates.phone !== undefined) dbUpdates.phone = updates.phone;
      supabase.from("team_members").update(dbUpdates).eq("id", id).then(() => {});
    }
  }, [useDb]);

  const value = useMemo(
    () => ({ members, pendingRequests, inviteMember, removeMember, updateMember, refreshPendingRequests }),
    [members, pendingRequests, inviteMember, removeMember, updateMember, refreshPendingRequests]
  );

  return <TeamContext.Provider value={value}>{children}</TeamContext.Provider>;
}

export function useTeam() {
  const ctx = useContext(TeamContext);
  if (!ctx) throw new Error("useTeam must be used within TeamProvider");
  return ctx;
}
