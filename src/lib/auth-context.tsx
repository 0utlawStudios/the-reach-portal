"use client";

import { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef, ReactNode } from "react";
import { supabase } from "./supabaseClient";
import { saveState } from "./persistence";

interface UserProfile {
  name: string;
  email: string;
  initials: string;
  avatar?: string;
  role?: string;
}

type ProvisionStatus = "unknown" | "active" | "pending" | "denied" | "error";

interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  currentUser: UserProfile;
  accessToken: string | null;
  provisionResult: { workspaceId: string } | null;
  provisionStatus: ProvisionStatus;
  provisionMessage: string | null;
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
const ACCESS_REVALIDATE_MS = 10 * 60 * 1000;
const SERVER_SESSION_COOKIE_TIMEOUT_MS = 5_000;
const WORKSPACE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type AuthSession = NonNullable<Awaited<ReturnType<typeof supabase.auth.getSession>>["data"]["session"]>;

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
async function enrichFromTeamMembers(email: string, profile: UserProfile, workspaceId?: string): Promise<UserProfile> {
  try {
    let query = supabase
      .from("team_members")
      .select("name, role, avatar_url, status")
      .eq("email", email);
    if (workspaceId) query = query.eq("workspace_id", workspaceId);
    const { data } = await query.maybeSingle();
    if (data) {
      // NOTE: previously this block auto-flipped status:"pending"→"active". That
      // defeats the admin approval flow — anyone who acquires an auth session
      // for a pending invite would self-promote. Activation must happen in the
      // server-side approve-request flow or the magic-link setup page only.
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

async function provisionWorkspace(token: string): Promise<{
  result: { workspaceId: string } | null;
  status: ProvisionStatus;
  message: string | null;
}> {
  const requestedWorkspaceId = workspaceIdFromLocation();
  try {
    const res = await fetch("/api/workspace/provision", {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(requestedWorkspaceId ? { "X-Workspace-Id": requestedWorkspaceId } : {}),
      },
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body?.workspaceId) {
      return { result: { workspaceId: body.workspaceId }, status: "active", message: null };
    }
    if (body?.status === "pending") {
      return { result: null, status: "pending", message: body.error || "Workspace access is pending." };
    }
    if (res.status === 403) {
      return { result: null, status: "denied", message: body?.error || "No active workspace access." };
    }
    return { result: null, status: "error", message: body?.error || "Workspace provisioning failed." };
  } catch {
    return { result: null, status: "error", message: "Workspace provisioning failed." };
  }
}

function workspaceIdFromLocation(): string | null {
  if (typeof window === "undefined") return null;
  const workspaceId = new URLSearchParams(window.location.search).get("workspaceId")?.trim() || "";
  return WORKSPACE_ID_RE.test(workspaceId) ? workspaceId : null;
}

async function syncServerSessionCookie(token: string): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SERVER_SESSION_COOKIE_TIMEOUT_MS);
  try {
    const res = await fetch("/api/auth/session-cookie", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Session cookie sync failed with HTTP ${res.status}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

function syncServerSessionCookieBestEffort(token: string): Promise<void> {
  return syncServerSessionCookie(token).catch((err) => {
    console.warn("[auth] server session cookie sync failed:", err instanceof Error ? err.message : err);
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [currentUser, setCurrentUser] = useState<UserProfile>(DEFAULT_USER);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [provisionResult, setProvisionResult] = useState<{ workspaceId: string } | null>(null);
  const [provisionStatus, setProvisionStatus] = useState<ProvisionStatus>("unknown");
  const [provisionMessage, setProvisionMessage] = useState<string | null>(null);

  // Tracks the email we've already fully provisioned for in this browser
  // session. Used to suppress redundant "Checking workspace access" flickers
  // when Supabase re-emits SIGNED_IN / INITIAL_SESSION on tab focus (its
  // built-in visibilitychange handler does this on every tab return, and
  // also when a sibling tab rotates the refresh token via the cross-tab
  // lock). For the same identity these events carry no new information,
  // so we keep the dashboard mounted and just refresh the access token.
  const provisionedEmailRef = useRef<string | null>(null);
  const currentUserRef = useRef<UserProfile>(DEFAULT_USER);
  const provisionStatusRef = useRef<ProvisionStatus>("unknown");
  const lastFullAccessCheckRef = useRef(0);
  const accessStateInFlightRef = useRef<{ key: string; promise: Promise<void> } | null>(null);

  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);

  useEffect(() => {
    provisionStatusRef.current = provisionStatus;
  }, [provisionStatus]);

  const applyAccessState = useCallback((session: AuthSession) => {
    const email = session.user.email || "";
    if (!email) return Promise.resolve();
    const key = session.user.id || email.toLowerCase();
    if (accessStateInFlightRef.current?.key === key) {
      return accessStateInFlightRef.current.promise;
    }
    const promise = (async () => {
      const meta = session.user.user_metadata || {};
      const fallbackProfile = currentUserRef.current.email.toLowerCase() === email.toLowerCase()
        ? currentUserRef.current
        : buildProfile(email, meta);
      const [provisioned] = await Promise.all([
        provisionWorkspace(session.access_token),
        syncServerSessionCookieBestEffort(session.access_token),
      ]);
      const enriched = provisioned.result
        ? await enrichFromTeamMembers(email, fallbackProfile, provisioned.result.workspaceId)
        : fallbackProfile;
      setIsAuthenticated(true);
      setAccessToken(session.access_token);
      setCurrentUser((prev) =>
        enriched.name === prev.name &&
        enriched.email === prev.email &&
        enriched.role === prev.role &&
        enriched.avatar === prev.avatar
          ? prev
          : enriched
      );
      setProvisionResult(provisioned.result);
      setProvisionStatus(provisioned.status);
      setProvisionMessage(provisioned.message);
      provisionStatusRef.current = provisioned.status;
      provisionedEmailRef.current = provisioned.status === "active" ? email : null;
      lastFullAccessCheckRef.current = Date.now();
    })().finally(() => {
      if (accessStateInFlightRef.current?.promise === promise) {
        accessStateInFlightRef.current = null;
      }
    });
    accessStateInFlightRef.current = { key, promise };
    return promise;
  }, []);

  // Check for existing Supabase session on mount
  useEffect(() => {
    async function init() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          await applyAccessState(session);
        }
      } catch (err) {
        console.error("[auth] init failed:", err);
      }
      setHydrated(true);
    }
    init();

    // Listen for auth state changes.
    // PERF-010: TOKEN_REFRESHED fires roughly hourly with no user-facing change.
    // Re-running buildProfile + enrichFromTeamMembers on every refresh cost a
    // round-trip and forced a currentUser identity change (cascade re-renders).
    // For TOKEN_REFRESHED, just bump accessToken and leave currentUser alone.
    //
    // Same-user re-emit guard: Supabase auth-js attaches its own
    // `visibilitychange` listener (GoTrueClient `_onVisibilityChanged`) that
    // re-emits SIGNED_IN / INITIAL_SESSION every time the tab returns to the
    // foreground, and also fires when a sibling tab rotates the refresh token
    // via the cross-tab lock. Treating those as full sign-ins flashed the
    // "Checking workspace access" gate on every tab switch. We now only run
    // the heavy path when the identity actually changed.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        const email = session.user.email || "";
        const isReEmitForSameUser =
          _event === "TOKEN_REFRESHED" ||
          (provisionedEmailRef.current !== null && email === provisionedEmailRef.current);
        if (isReEmitForSameUser) {
          setAccessToken(session.access_token);
          void syncServerSessionCookieBestEffort(session.access_token);
          return;
        }
        const meta = session.user.user_metadata || {};
        const profile = buildProfile(email, meta);
        setCurrentUser(profile);
        setIsAuthenticated(true);
        setAccessToken(session.access_token);
        setProvisionStatus("unknown");
        setProvisionMessage(null);
        // Enrich from DB in background (non-blocking).
        // PERF-004: only call setCurrentUser a second time when the enriched
        // profile actually differs (name/role/avatar). Mirrors the AvatarSync
        // equality guard so a no-op enrich does not trigger a cascade re-render.
        void applyAccessState(session).catch((err) => console.error("[auth] sign-in access check failed:", err));
      } else {
        setIsAuthenticated(false);
        setCurrentUser(DEFAULT_USER);
        setAccessToken(null);
        setProvisionResult(null);
        setProvisionStatus("unknown");
        setProvisionMessage(null);
        provisionedEmailRef.current = null;
      }
    });

    return () => { subscription.unsubscribe(); };
  }, [applyAccessState]);

  useEffect(() => {
    if (!hydrated || !isAuthenticated) return;
    const refreshIfVisible = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      supabase.auth.getSession()
        .then(({ data: { session } }) => {
          if (!session?.user) return;
          const email = session.user.email || "";
          setAccessToken(session.access_token);
          const needsFullCheck =
            provisionStatusRef.current !== "active" ||
            provisionedEmailRef.current?.toLowerCase() !== email.toLowerCase() ||
            Date.now() - lastFullAccessCheckRef.current > ACCESS_REVALIDATE_MS;
          if (needsFullCheck) return applyAccessState(session);
        })
        .catch((err) => console.error("[auth] scheduled access refresh failed:", err));
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshIfVisible();
    };
    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", onVisible);
    const interval = window.setInterval(refreshIfVisible, ACCESS_REVALIDATE_MS);
    return () => {
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(interval);
    };
  }, [hydrated, isAuthenticated, applyAccessState]);

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
    const [provisioned] = await Promise.all([
      provisionWorkspace(data.session.access_token),
      syncServerSessionCookieBestEffort(data.session.access_token),
    ]);
    const enriched = provisioned.result
      ? await enrichFromTeamMembers(userEmail, profile, provisioned.result.workspaceId)
      : profile;
    profile = enriched;
    setCurrentUser(profile);
    setIsAuthenticated(true);
    setAccessToken(data.session.access_token);
    setProvisionResult(provisioned.result);
    setProvisionStatus(provisioned.status);
    setProvisionMessage(provisioned.message);
    provisionStatusRef.current = provisioned.status;
    lastFullAccessCheckRef.current = Date.now();
    // Mark this identity as already-provisioned so the SIGNED_IN re-emit
    // that fires immediately after signInWithPassword is treated as a no-op
    // and does not flash the "Checking workspace access" gate.
    if (provisioned.status === "active") provisionedEmailRef.current = userEmail;
    // Reset navigation to dashboard on fresh login
    saveState("nav_page", "dashboard");
    return null;
  }, []);

  const logout = useCallback(async () => {
    // scope:"global" revokes the refresh token server-side so the session
    // cannot be reused if cookies/localStorage are recovered after sign-out.
    try {
      await supabase.auth.signOut({ scope: "global" });
    } finally {
      await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    }
    setIsAuthenticated(false);
    setCurrentUser(DEFAULT_USER);
    setAccessToken(null);
    setProvisionResult(null);
    setProvisionStatus("unknown");
    setProvisionMessage(null);
    provisionedEmailRef.current = null;
    provisionStatusRef.current = "unknown";
    lastFullAccessCheckRef.current = 0;
  }, []);

  const updateCurrentUserAvatar = useCallback((avatar: string | undefined) => {
    setCurrentUser((prev) => ({ ...prev, avatar }));
  }, []);

  const value = useMemo(
    () => ({
      isAuthenticated,
      isLoading: !hydrated,
      currentUser,
      accessToken,
      provisionResult,
      provisionStatus,
      provisionMessage,
      updateCurrentUserAvatar,
      login,
      logout,
    }),
    [isAuthenticated, hydrated, currentUser, accessToken, provisionResult, provisionStatus, provisionMessage, updateCurrentUserAvatar, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
