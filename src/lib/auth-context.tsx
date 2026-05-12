"use client";

import { createContext, useContext, useState, useCallback, useMemo, useEffect, ReactNode } from "react";
import { supabase } from "./supabaseClient";
import { saveState } from "./persistence";

interface UserProfile {
  name: string;
  email: string;
  initials: string;
  avatar?: string;
  role?: string;
}

interface AuthContextType {
  isAuthenticated: boolean;
  currentUser: UserProfile;
  accessToken: string | null;
  provisionResult: { workspaceId: string } | null;
  updateCurrentUserAvatar: (avatar: string | undefined) => void;
  login: (email: string, password: string) => Promise<string | null>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

/** Capitalize each word: "aldridge dagos" → "Aldridge Dagos" */
function capitalize(str: string): string {
  return str.replace(/\b\w/g, (c) => c.toUpperCase());
}

const DEFAULT_USER: UserProfile = {
  name: "Guest",
  email: "",
  initials: "G",
};

/** Build a profile from auth metadata, with proper capitalization */
function buildProfile(email: string, meta: Record<string, unknown>): UserProfile {
  const rawName = typeof meta.name === "string" ? meta.name : email.split("@")[0] || "User";
  const name = capitalize(rawName);
  return {
    name,
    email,
    initials: getInitials(name),
    role: typeof meta.role === "string" ? meta.role : undefined,
  };
}

/** Enrich profile with team_members data (real name, role, avatar) */
async function enrichFromTeamMembers(email: string, profile: UserProfile): Promise<UserProfile> {
  try {
    const { data } = await supabase
      .from("team_members")
      .select("name, role, avatar_url, status")
      .eq("email", email)
      .single();
    if (data) {
      // Auto-activate: if user has a valid auth session but is still pending, flip to active
      if (data.status === "pending") {
        supabase.from("team_members").update({ status: "active" }).eq("email", email).then(({ error }) => {
          if (error) console.error("[auth] auto-activate failed:", error.message);
        });
      }
      const name = data.name || profile.name;
      return {
        ...profile,
        name,
        initials: getInitials(name),
        role: data.role || profile.role,
        avatar: data.avatar_url || profile.avatar,
      };
    }
  } catch { /* DB not available, use auth metadata */ }
  return profile;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [currentUser, setCurrentUser] = useState<UserProfile>(DEFAULT_USER);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [provisionResult, setProvisionResult] = useState<{ workspaceId: string } | null>(null);

  // Check for existing Supabase session on mount
  useEffect(() => {
    async function init() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          const token = session.access_token;
          const email = session.user.email || "";
          const meta = session.user.user_metadata || {};
          const profile = buildProfile(email, meta);
          // Fire provision and team enrich in parallel — provision completes
          // before PipelineProvider ever mounts, eliminating the waterfall.
          const [enriched, provisioned] = await Promise.all([
            enrichFromTeamMembers(email, profile),
            fetch("/api/workspace/provision", {
              headers: { Authorization: `Bearer ${token}` },
            }).then((r) => r.ok ? r.json() : null).catch(() => null),
          ]);
          setCurrentUser(enriched);
          setIsAuthenticated(true);
          setAccessToken(token);
          if (provisioned?.workspaceId) setProvisionResult(provisioned);
        }
      } catch (err) {
        console.error("[auth] init failed:", err);
      }
      setHydrated(true);
    }
    init();

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        const email = session.user.email || "";
        const meta = session.user.user_metadata || {};
        const profile = buildProfile(email, meta);
        setCurrentUser(profile);
        setIsAuthenticated(true);
        // Enrich from DB in background (non-blocking)
        enrichFromTeamMembers(email, profile).then((enriched) => {
          setCurrentUser(enriched);
        }).catch(() => {});
      } else {
        setIsAuthenticated(false);
        setCurrentUser(DEFAULT_USER);
      }
    });

    return () => { subscription.unsubscribe(); };
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<string | null> => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.toLowerCase().trim(),
      password,
    });
    if (error) return error.message;
    if (!data.session) return "No session returned";

    const userEmail = data.user?.email || email;
    const meta = data.user?.user_metadata || {};
    let profile = buildProfile(userEmail, meta);
    profile = await enrichFromTeamMembers(userEmail, profile);
    setCurrentUser(profile);
    setIsAuthenticated(true);
    // Reset navigation to dashboard on fresh login
    saveState("nav_page", "dashboard");
    return null;
  }, []);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setIsAuthenticated(false);
    setCurrentUser(DEFAULT_USER);
  }, []);

  const updateCurrentUserAvatar = useCallback((avatar: string | undefined) => {
    setCurrentUser((prev) => ({ ...prev, avatar }));
  }, []);

  const value = useMemo(
    () => ({ isAuthenticated, currentUser, accessToken, provisionResult, updateCurrentUserAvatar, login, logout }),
    [isAuthenticated, currentUser, accessToken, provisionResult, updateCurrentUserAvatar, login, logout]
  );

  if (!hydrated) return null;

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
