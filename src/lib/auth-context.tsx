"use client";

import { createContext, useContext, useState, useCallback, useMemo, useEffect, ReactNode } from "react";

interface UserProfile {
  name: string;
  email: string;
  initials: string;
  avatar?: string;
}

interface AuthContextType {
  isAuthenticated: boolean;
  isDemo: boolean;
  currentUser: UserProfile;
  updateCurrentUserAvatar: (avatar: string | undefined) => void;
  login: (email: string, password: string) => boolean;
  loginDemo: () => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

const VALID_CREDENTIALS = {
  email: "aldridge@ten80ten.com",
  password: "ten80ten2026",
};

const DEFAULT_USER: UserProfile = {
  name: "Aldridge Dagos",
  email: "aldridge@ten80ten.com",
  initials: "AD",
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isDemo, setIsDemo] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [currentUser, setCurrentUser] = useState<UserProfile>(DEFAULT_USER);

  useEffect(() => {
    setIsAuthenticated(sessionStorage.getItem("t10_auth") === "true");
    setIsDemo(sessionStorage.getItem("t10_demo") === "true");
    setHydrated(true);
  }, []);

  const login = useCallback((email: string, password: string) => {
    if (email.toLowerCase().trim() === VALID_CREDENTIALS.email && password === VALID_CREDENTIALS.password) {
      setIsAuthenticated(true);
      setIsDemo(false);
      sessionStorage.setItem("t10_auth", "true");
      sessionStorage.removeItem("t10_demo");
      return true;
    }
    return false;
  }, []);

  const loginDemo = useCallback(() => {
    setIsAuthenticated(true);
    setIsDemo(true);
    sessionStorage.setItem("t10_auth", "true");
    sessionStorage.setItem("t10_demo", "true");
  }, []);

  const logout = useCallback(() => {
    setIsAuthenticated(false);
    setIsDemo(false);
    sessionStorage.removeItem("t10_auth");
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
