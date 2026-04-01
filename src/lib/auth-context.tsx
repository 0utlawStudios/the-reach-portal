"use client";

import { createContext, useContext, useState, useCallback, useMemo, useEffect, ReactNode } from "react";
import { supabase } from "./supabaseClient";

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
  updateCurrentUserAvatar: (avatar: string | undefined) => void;
  login: (email: string, password: string) => Promise<boolean>;
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
function buildProfile(email: string, meta: Record<string, any>): UserProfile {
  const rawName = meta.name || email.split("@")[0] || "User";
  const name = capitalize(rawName);
  return {
    name,
    email,
    initials: getInitials(name),
    role: meta.role,
  };
}

/** Enrich profile with team_members data (real name, role, avatar) */
async function enrichFromTeamMembers(email: string, profile: UserProfile): Promise<UserProfile> {
  try {
    const { data } = await supabase
      .from("team_members")
      .select("name, role, avatar_url")
      .eq("email", email)
      .single();
    if (data) {
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

  // Check for existing Supabase session on mount
  useEffect(() => {
    async function init() {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const email = session.user.email || "";
        const meta = session.user.user_metadata || {};
        let profile = buildProfile(email, meta);
        profile = await enrichFromTeamMembers(email, profile);
        setCurrentUser(profile);
        setIsAuthenticated(true);
      }
      setHydrated(true);
    }
    init();

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        const email = session.user.email || "";
        const meta = session.user.user_metadata || {};
        let profile = buildProfile(email, meta);
        profile = await enrichFromTeamMembers(email, profile);
        setCurrentUser(profile);
        setIsAuthenticated(true);
      } else {
        setIsAuthenticated(false);
        setCurrentUser(DEFAULT_USER);
      }
    });

    return () => { subscription.unsubscribe(); };
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<boolean> => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.toLowerCase().trim(),
      password,
    });
    if (error || !data.session) return false;

    const userEmail = data.user?.email || email;
    const meta = data.user?.user_metadata || {};
    let profile = buildProfile(userEmail, meta);
    profile = await enrichFromTeamMembers(userEmail, profile);
    setCurrentUser(profile);
    setIsAuthenticated(true);
    return true;
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
    () => ({ isAuthenticated, currentUser, updateCurrentUserAvatar, login, logout }),
    [isAuthenticated, currentUser, updateCurrentUserAvatar, login, logout]
  );

  if (!hydrated) return null;

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
