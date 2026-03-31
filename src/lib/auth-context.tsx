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
  isDemo: boolean;
  currentUser: UserProfile;
  updateCurrentUserAvatar: (avatar: string | undefined) => void;
  login: (email: string, password: string) => Promise<boolean>;
  loginDemo: () => void;
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

const DEFAULT_USER: UserProfile = {
  name: "Guest",
  email: "",
  initials: "G",
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isDemo, setIsDemo] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [currentUser, setCurrentUser] = useState<UserProfile>(DEFAULT_USER);

  // Check for existing Supabase session on mount
  useEffect(() => {
    async function init() {
      // Check demo mode first
      if (sessionStorage.getItem("t10_demo") === "true") {
        setIsAuthenticated(true);
        setIsDemo(true);
        setCurrentUser({ name: "Demo User", email: "demo@ten80ten.com", initials: "DU" });
        setHydrated(true);
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const meta = session.user.user_metadata || {};
        const name = meta.name || session.user.email?.split("@")[0] || "User";
        setCurrentUser({
          name,
          email: session.user.email || "",
          initials: getInitials(name),
          role: meta.role,
        });
        setIsAuthenticated(true);
      }
      setHydrated(true);
    }
    init();

    // Listen for auth state changes (e.g., token refresh, signout from another tab)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        const meta = session.user.user_metadata || {};
        const name = meta.name || session.user.email?.split("@")[0] || "User";
        setCurrentUser({
          name,
          email: session.user.email || "",
          initials: getInitials(name),
          role: meta.role,
        });
        setIsAuthenticated(true);
        setIsDemo(false);
      } else if (!sessionStorage.getItem("t10_demo")) {
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

    const meta = data.user?.user_metadata || {};
    const name = meta.name || email.split("@")[0];
    setCurrentUser({
      name,
      email: data.user?.email || email,
      initials: getInitials(name),
      role: meta.role,
    });
    setIsAuthenticated(true);
    setIsDemo(false);
    sessionStorage.removeItem("t10_demo");
    return true;
  }, []);

  const loginDemo = useCallback(() => {
    setIsAuthenticated(true);
    setIsDemo(true);
    setCurrentUser({ name: "Demo User", email: "demo@ten80ten.com", initials: "DU" });
    sessionStorage.setItem("t10_demo", "true");
  }, []);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setIsAuthenticated(false);
    setIsDemo(false);
    setCurrentUser(DEFAULT_USER);
    sessionStorage.removeItem("t10_demo");
  }, []);

  const updateCurrentUserAvatar = useCallback((avatar: string | undefined) => {
    setCurrentUser((prev) => ({ ...prev, avatar }));
  }, []);

  const value = useMemo(
    () => ({ isAuthenticated, isDemo, currentUser, updateCurrentUserAvatar, login, loginDemo, logout }),
    [isAuthenticated, isDemo, currentUser, updateCurrentUserAvatar, login, loginDemo, logout]
  );

  if (!hydrated) return null;

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
