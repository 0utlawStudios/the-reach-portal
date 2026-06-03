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
  updateMember: (id: string, updates: Partial<TeamMember>) => Promise<boolean>;
  refreshMembers: () => Promise<void>;
  refreshPendingRequests: () => void;
}

const TeamContext = createContext<TeamContextType | null>(null);
const STORAGE_KEY = "reach_team_members";

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
const TEAM_MEMBER_SELECT =
  "id, name, email, phone, role, secondary_role, status, joined_at, created_at, updated_at, avatar_url";
const TEAM_REFRESH_MS = 5 * 60 * 1000;
const PENDING_REQUEST_REFRESH_MS = 60 * 1000;

export function TeamProvider({ children }: { children: ReactNode }) {
  const { addToast } = useToast();
  const [members, setMembers] = useState<TeamMember[]>(DEFAULT_MEMBERS);
  const [pendingRequests, setPendingRequests] = useState<SignupRequest[]>([]);
  const hydrated = useRef(false);
  // PERF-015: debounce localStorage writes so a burst of realtime updates
  // (e.g. five member rows arriving back-to-back) collapses into one save.
  const persistTimeoutRef = useRef<number | null>(null);
  const useDb = isSupabaseConfigured();

  const refreshMembers = useCallback(async () => {
    if (!useDb) {
      setMembers(loadState(STORAGE_KEY, DEFAULT_MEMBERS));
      hydrated.current = true;
      return;
    }
    try {
      const { data, error } = await supabase
        .from("team_members")
        .select(TEAM_MEMBER_SELECT)
        .order("joined_at");
      if (error) {
        console.error("[team] load failed:", error.message);
        // With Supabase configured, stale localStorage is worse than an empty
        // authoritative view because it can make revoked/pending access look
        // active. Keep the UI honest and let AppShell handle access failures.
        setMembers(DEFAULT_MEMBERS);
        addToast("Could not refresh team members. Try again.", "error");
        hydrated.current = true;
        return;
      }
      setMembers((data || []).map(dbToMember));
    } catch (err) {
      console.error("[team] load failed:", err);
      setMembers(DEFAULT_MEMBERS);
      addToast("Could not refresh team members. Try again.", "error");
    }
    hydrated.current = true;
  }, [useDb, addToast]);

  useEffect(() => {
    void Promise.resolve().then(() => refreshMembers());
  }, [refreshMembers]);

  // Load pending signup requests
  const refreshPendingRequests = useCallback(() => {
    if (!useDb) return;
    supabase
      .from("signup_requests")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) {
          console.error("[team] pending request load failed:", error.message);
          return;
        }
        setPendingRequests(data || []);
      });
  }, [useDb]);

  useEffect(() => {
    refreshPendingRequests();
  }, [refreshPendingRequests]);

  useEffect(() => {
    if (!useDb) return;
    const refreshIfVisible = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      refreshPendingRequests();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshPendingRequests();
    };
    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", onVisible);
    const interval = window.setInterval(refreshIfVisible, PENDING_REQUEST_REFRESH_MS);
    return () => {
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(interval);
    };
  }, [useDb, refreshPendingRequests]);

  // ─── Low-cost freshness for team changes ───
  // Team membership changes are rare and every local mutation already calls
  // refreshMembers(). A permanent postgres_changes subscription costs a
  // Realtime polling slot in every authenticated browser tab, which showed up
  // as the dominant production query family in Supabase Observability.
  // Refresh on focus/visibility and a slow visible-tab interval instead.
  useEffect(() => {
    if (!useDb) return;
    const refreshIfVisible = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      void refreshMembers();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshMembers();
    };
    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", onVisible);
    const interval = window.setInterval(refreshIfVisible, TEAM_REFRESH_MS);
    return () => {
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(interval);
    };
  }, [useDb, refreshMembers]);

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
      supabase
        .from("team_members")
        .insert({ name, email, role, status: "pending" })
        .select(TEAM_MEMBER_SELECT)
        .single()
        .then(({ data, error }) => {
          if (error) {
            console.error("[team] inviteMember sync failed:", error.message);
            setMembers((prev) => prev.filter((m) => m.id !== tempId));
            addToast(`Invite failed: ${error.message}. Member was not added.`, "error");
            return;
          }
          if (data) {
            setMembers((prev) => prev.map((m) => m.id === tempId ? { ...m, id: data.id } : m));
          }
        });
    }
  }, [useDb, addToast]);

  const removeMember = useCallback((id: string, email: string, requestedBy: string) => {
    // DATA-007: snapshot the member so a failed delete can be rolled back.
    const previousMember = members.find((m) => m.id === id);
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
        }).then(async (res) => {
          const data = await res.json().catch(() => ({}));
          // On failure, restore the optimistically removed member so the UI
          // does not show someone as gone when they still have access.
          if (!res.ok && previousMember) {
            setMembers((prev) => prev.some((m) => m.id === id) ? prev : [...prev, previousMember]);
            addToast(`Remove failed: ${data.error || "member was restored"}.`, "error");
          } else if (res.ok) {
            addToast(`${email} removed from team, workspace access, and auth.`, "success");
          }
          void refreshMembers();
        }).catch(() => {
          if (previousMember) {
            setMembers((prev) => prev.some((m) => m.id === id) ? prev : [...prev, previousMember]);
            addToast("Remove failed. Member was restored.", "error");
          }
          void refreshMembers();
        });
      }).catch(() => {
        if (previousMember) {
          setMembers((prev) => prev.some((m) => m.id === id) ? prev : [...prev, previousMember]);
          addToast("Remove failed. Member was restored.", "error");
        }
        void refreshMembers();
      });
    }
  }, [useDb, members, addToast, refreshMembers]);

  const updateMember = useCallback(async (id: string, updates: Partial<TeamMember>): Promise<boolean> => {
    // DATA-007: snapshot the member so a failed update can be rolled back.
    const previousMember = members.find((m) => m.id === id);
    setMembers((prev) => prev.map((m) => m.id === id ? { ...m, ...updates } : m));
    if (useDb) {
      const apiUpdates: Partial<TeamMember> = {};
      if (updates.name !== undefined) apiUpdates.name = updates.name;
      if (updates.role !== undefined) apiUpdates.role = updates.role;
      if (updates.avatar !== undefined) apiUpdates.avatar = updates.avatar;
      if (updates.phone !== undefined) apiUpdates.phone = updates.phone;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const headers: HeadersInit = { "Content-Type": "application/json" };
        if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
        const res = await fetch("/api/team/update-member", {
          method: "POST",
          headers,
          body: JSON.stringify({ memberId: id, updates: apiUpdates }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (previousMember) setMembers((prev) => prev.map((m) => m.id === id ? previousMember : m));
          addToast(`Update failed: ${data.error || "changes reverted"}.`, "error");
          return false;
        }
        return true;
      } catch {
        if (previousMember) setMembers((prev) => prev.map((m) => m.id === id ? previousMember : m));
        addToast("Update failed. Changes reverted.", "error");
        return false;
      }
    }
    return true;
  }, [useDb, members, addToast]);

  const value = useMemo(
    () => ({ members, pendingRequests, inviteMember, removeMember, updateMember, refreshMembers, refreshPendingRequests }),
    [members, pendingRequests, inviteMember, removeMember, updateMember, refreshMembers, refreshPendingRequests]
  );

  return <TeamContext.Provider value={value}>{children}</TeamContext.Provider>;
}

export function useTeam() {
  const ctx = useContext(TeamContext);
  if (!ctx) throw new Error("useTeam must be used within TeamProvider");
  return ctx;
}
