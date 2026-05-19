// Five-path "last seen + online status" — client side.
//
// Architecture:
//   1. AUDIT TRIGGER (server-side, automatic):
//      Every record_audit_event() insert fires sync_presence_from_audit() in
//      Postgres. Pure server path — works even if every browser is closed.
//   2. CLIENT 60s HEARTBEAT (this file):
//      While the tab is visible, calls touch_my_presence(activity) every 60s.
//   3. ROUTE-CHANGE PING (this file):
//      Every Next.js pathname change calls touch_my_presence_throttled(),
//      which throttles to 60s server-side. Acts as the "every authenticated
//      request" path adapted for an SPA. Free-running protection: even if the
//      user idles on one page, navigating bumps presence.
//   4. DEPARTURE BEACON (this file → /api/presence/departure):
//      pagehide → navigator.sendBeacon({token}) → server upsert.
//      pagehide replaces unload reliably on iOS Safari AND covers BFCache entry
//      on both iOS Safari (persisted=true) and Chrome (fires before freeze).
//      The Chrome-specific `freeze` event used to be wired here too but caused
//      a 60s-cadence leak: heartbeat tick wakes the backgrounded tab → Chrome
//      re-freezes → freeze event re-fires → beacon spam (~1,440 calls/day/tab).
//      Discovered 2026-05-20 via Vercel runtime log audit.
//      Departure also has a 5-minute cooldown guard as belt-and-suspenders.
//   5. REALTIME PRESENCE CHANNEL (this file):
//      Supabase realtime channel keyed by email, broadcasts active/idle/away.
//      Live indicator only — does not write the DB. The DB write paths above
//      are what guarantee correctness; this just makes the dot live.
//
// For last_seen_at to be wrong, ALL FIVE paths must fail simultaneously,
// AND the user must take no state-changing action that fires an audit event.
//
// The hook signature `usePresence(userEmail, workspaceId)` is preserved for
// backwards compatibility with existing call sites (settings-page.tsx) — the
// args are ignored when a PresenceProvider is mounted upstream, which it
// always is when authenticated.

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { supabase } from "./supabaseClient";
import { useAuth } from "./auth-context";

// ─── TYPES ───────────────────────────────────────────────────────────────

export type PresenceStatus = "active" | "idle" | "away" | "offline";

export interface PeerPresence {
  email: string;
  status: PresenceStatus;
  lastSeen: string;
}

export interface PresenceSummaryRow {
  team_member_id: string;
  full_name: string | null;
  email: string;
  auth_user_id: string | null;
  presence_last_seen: string | null;
  presence_last_active: string | null;
  audit_last: string | null;
  auth_last_sign_in: string | null;
  best_known_seen: string | null;
}

interface PresenceContextValue {
  presenceMap: Record<string, PeerPresence>;
  summaryMap: Record<string, PresenceSummaryRow>;
  myEmail: string;
  getStatus: (email: string) => PresenceStatus;
  getSummary: (email: string) => PresenceSummaryRow | undefined;
}

const PresenceContext = createContext<PresenceContextValue | null>(null);

// ─── CONFIG ──────────────────────────────────────────────────────────────

const BASELINE_WORKSPACE = "00000000-0000-0000-0000-000000000001";

// Realtime priority — multi-tab aggregation picks the highest.
const STATUS_RANK: Record<PresenceStatus, number> = {
  active: 3,
  idle: 2,
  away: 1,
  offline: 0,
};

const isSupabaseConfigured = !!(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
  process.env.NEXT_PUBLIC_SUPABASE_URL !== "https://placeholder.supabase.co"
);

// Activity thresholds.
const ACTIVE_FOR_MS = 5 * 60 * 1000; // 5 min
const IDLE_FOR_MS = 15 * 60 * 1000; // 15 min → away
const ACTIVITY_BROADCAST_THROTTLE_MS = 10 * 1000;
const HEARTBEAT_MS = 60 * 1000;
const FLAP_GUARD_MS = 5 * 1000;
const SUMMARY_REFRESH_MS = 60 * 1000;
const DEPARTURE_COOLDOWN_MS = 5 * 60 * 1000; // dedupe rapid-fire pagehide / iframe nav events

const ACTIVITY_EVENTS: Array<keyof DocumentEventMap | keyof WindowEventMap> = [
  "mousemove",
  "keydown",
  "click",
  "scroll",
  "touchstart",
];

// ─── PROVIDER ────────────────────────────────────────────────────────────

export function PresenceProvider({
  children,
  workspaceId,
}: {
  children: ReactNode;
  workspaceId?: string;
}) {
  const { isAuthenticated, currentUser, accessToken } = useAuth();
  const pathname = usePathname();

  const myEmail = currentUser.email;
  const wsId = workspaceId || BASELINE_WORKSPACE;

  // Realtime peer map (the live channel state).
  const [presenceMap, setPresenceMap] = useState<Record<string, PeerPresence>>({});

  // DB-hydrated summary (last_seen_at + audit_last + auth_last_sign_in per email).
  const [summaryMap, setSummaryMap] = useState<Record<string, PresenceSummaryRow>>({});

  // Sync state. Numeric refs initialised to 0 (not Date.now()) to keep render
  // pure per react-hooks/purity; seeded to wall-clock values in the first
  // mount effect below.
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const hasSyncedOnceRef = useRef(false);
  const lastNonEmptySyncRef = useRef<number>(0);
  const lastActivityRef = useRef<number>(0);
  const lastBroadcastRef = useRef<number>(0);
  const currentStatusRef = useRef<PresenceStatus>("active");
  const heartbeatRef = useRef<number | null>(null);
  const summaryRefreshRef = useRef<number | null>(null);
  const lastDepartureRef = useRef<number>(0);

  useEffect(() => {
    lastActivityRef.current = Date.now();
  }, []);

  // ── status derivation from local activity + tab visibility ──
  const deriveLocalStatus = useCallback((): PresenceStatus => {
    if (typeof document === "undefined") return "active";
    const age = Date.now() - lastActivityRef.current;
    if (document.hidden && age > IDLE_FOR_MS) return "away";
    if (document.hidden) return "idle";
    if (age < ACTIVE_FOR_MS) return "active";
    if (age < IDLE_FOR_MS) return "idle";
    return "away";
  }, []);

  // ── channel.track wrapper, throttled to 10s ──
  const broadcastStatusIfNeeded = useCallback(
    (forceStatus?: PresenceStatus) => {
      const ch = channelRef.current;
      if (!ch || !myEmail) return;
      const next = forceStatus ?? deriveLocalStatus();
      const now = Date.now();
      const changed = next !== currentStatusRef.current;
      if (!changed && now - lastBroadcastRef.current < ACTIVITY_BROADCAST_THROTTLE_MS) return;
      currentStatusRef.current = next;
      lastBroadcastRef.current = now;
      ch.track({
        email: myEmail,
        status: next,
        lastSeen: new Date(now).toISOString(),
      }).catch(() => undefined);
    },
    [myEmail, deriveLocalStatus],
  );

  // ── server presence write (path 2 + 3 + 4 entrypoint) ──
  const touchPresence = useCallback(async (activity: boolean) => {
    if (!isSupabaseConfigured) return;
    try {
      await supabase.rpc("touch_my_presence", { activity });
    } catch (err) {
      console.error("[presence] touch_my_presence failed", err);
    }
  }, []);

  const touchPresenceThrottled = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    try {
      await supabase.rpc("touch_my_presence_throttled");
    } catch (err) {
      console.error("[presence] touch_my_presence_throttled failed", err);
    }
  }, []);

  // ── summary refresh (DB view) ──
  const refreshSummary = useCallback(async () => {
    if (!isSupabaseConfigured || !isAuthenticated) return;
    try {
      const { data, error } = await supabase
        .from("v_user_presence_summary")
        .select("*");
      if (error || !data) return;
      const next: Record<string, PresenceSummaryRow> = {};
      for (const row of data as PresenceSummaryRow[]) {
        if (row.email) next[row.email.toLowerCase()] = row;
      }
      setSummaryMap(next);
    } catch (err) {
      console.error("[presence] summary refresh failed", err);
    }
  }, [isAuthenticated]);

  // ── activity listener (throttled broadcast) ──
  useEffect(() => {
    if (!isAuthenticated || !myEmail) return;
    const onActivity = () => {
      lastActivityRef.current = Date.now();
      broadcastStatusIfNeeded();
    };
    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, onActivity, { passive: true });
    }
    return () => {
      for (const ev of ACTIVITY_EVENTS) {
        window.removeEventListener(ev, onActivity);
      }
    };
  }, [isAuthenticated, myEmail, broadcastStatusIfNeeded]);

  // ── 60s heartbeat (path 2) + status decay watcher ──
  useEffect(() => {
    if (!isAuthenticated || !myEmail) return;
    const tick = () => {
      if (typeof document !== "undefined" && !document.hidden) {
        const status = deriveLocalStatus();
        void touchPresence(status === "active");
        broadcastStatusIfNeeded(status);
      } else {
        broadcastStatusIfNeeded();
      }
    };
    heartbeatRef.current = window.setInterval(tick, HEARTBEAT_MS);
    return () => {
      if (heartbeatRef.current) window.clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    };
  }, [isAuthenticated, myEmail, touchPresence, deriveLocalStatus, broadcastStatusIfNeeded]);

  // ── route change ping (path 3) ──
  useEffect(() => {
    if (!isAuthenticated || !myEmail) return;
    void touchPresenceThrottled();
  }, [pathname, isAuthenticated, myEmail, touchPresenceThrottled]);

  // ── visibility recovery + departure beacon (path 4) ──
  useEffect(() => {
    if (!isAuthenticated || !myEmail) return;

    const onVisibility = () => {
      if (!document.hidden) {
        lastActivityRef.current = Date.now();
        void touchPresence(true);
        broadcastStatusIfNeeded("active");
      } else {
        broadcastStatusIfNeeded();
      }
    };

    const departure = () => {
      const now = Date.now();
      // Cooldown guard: prevents rapid-fire beacon spam if any event source
      // (iframe nav, multiple pagehide cycles, etc) triggers this in quick
      // succession. Original Chrome `freeze` event was removed entirely below;
      // this is the second line of defense.
      if (now - lastDepartureRef.current < DEPARTURE_COOLDOWN_MS) return;
      lastDepartureRef.current = now;
      try {
        const payload = JSON.stringify({ token: accessToken, ts: now });
        const blob = new Blob([payload], { type: "application/json" });
        if (navigator.sendBeacon) {
          navigator.sendBeacon("/api/presence/departure", blob);
        } else {
          // Best-effort fallback for old browsers.
          void fetch("/api/presence/departure", {
            method: "POST",
            keepalive: true,
            body: payload,
            headers: { "Content-Type": "application/json" },
          }).catch(() => undefined);
        }
      } catch (err) {
        console.error("[presence] departure beacon failed", err);
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", departure);
    // NOTE: previously also listened on document "freeze" event. Removed
    // 2026-05-20 — Chrome's freeze fires repeatedly when a backgrounded tab
    // cycles through freeze/wake (waking caused by the 60s heartbeat tick),
    // creating ~1,440 beacon calls per stuck tab per day. pagehide covers
    // BFCache entry on both iOS Safari and Chrome; freeze is redundant.

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", departure);
    };
  }, [isAuthenticated, myEmail, accessToken, touchPresence, broadcastStatusIfNeeded]);

  // ── summary view periodic refresh ──
  // Initial fetch is deferred via setTimeout(0) so the setState that lands
  // inside refreshSummary runs in a callback rather than synchronously in the
  // effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!isAuthenticated) return;
    const initial = window.setTimeout(refreshSummary, 0);
    summaryRefreshRef.current = window.setInterval(refreshSummary, SUMMARY_REFRESH_MS);
    return () => {
      window.clearTimeout(initial);
      if (summaryRefreshRef.current) window.clearInterval(summaryRefreshRef.current);
      summaryRefreshRef.current = null;
    };
  }, [isAuthenticated, refreshSummary]);

  // ── realtime channel (path 5) ──
  useEffect(() => {
    if (!isSupabaseConfigured || !isAuthenticated || !myEmail) return;

    const channel = supabase.channel(`presence-${wsId}`, {
      config: { presence: { key: myEmail } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<PeerPresence>();
        const keys = Object.keys(state);

        // Flap guard: if we previously had peers and the sync briefly returns
        // empty, ignore for FLAP_GUARD_MS before accepting the empty state.
        if (keys.length === 0 && hasSyncedOnceRef.current) {
          const sinceLast = Date.now() - lastNonEmptySyncRef.current;
          if (sinceLast < FLAP_GUARD_MS) return;
        }

        const map: Record<string, PeerPresence> = {};
        for (const [key, entries] of Object.entries(state)) {
          if (!entries || entries.length === 0) continue;
          // Multi-tab aggregation: pick the highest-priority status across tabs.
          let best: PeerPresence | null = null;
          for (const raw of entries as unknown as PeerPresence[]) {
            const cand: PeerPresence = {
              email: raw.email || key,
              status: (raw.status || "active") as PresenceStatus,
              lastSeen: raw.lastSeen || new Date().toISOString(),
            };
            if (!best || STATUS_RANK[cand.status] > STATUS_RANK[best.status]) {
              best = cand;
            }
          }
          if (best) map[key.toLowerCase()] = best;
        }
        if (keys.length > 0) lastNonEmptySyncRef.current = Date.now();
        hasSyncedOnceRef.current = true;
        setPresenceMap(map);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          lastActivityRef.current = Date.now();
          currentStatusRef.current = "active";
          lastBroadcastRef.current = Date.now();
          await channel.track({
            email: myEmail,
            status: "active" as PresenceStatus,
            lastSeen: new Date().toISOString(),
          });
        }
      });

    channelRef.current = channel;
    return () => {
      channel.unsubscribe();
      channelRef.current = null;
      hasSyncedOnceRef.current = false;
    };
  }, [isAuthenticated, myEmail, wsId]);

  // ── derived peer-state accessor ──
  const getStatus = useCallback(
    (email: string): PresenceStatus => {
      if (!email) return "offline";
      const key = email.toLowerCase();
      // Optimistic self-render: while the channel hasn't synced yet, the user
      // is definitely "active" if they're looking at their own card.
      if (myEmail && key === myEmail.toLowerCase() && !hasSyncedOnceRef.current) {
        return "active";
      }
      return presenceMap[key]?.status || "offline";
    },
    [presenceMap, myEmail],
  );

  const getSummary = useCallback(
    (email: string): PresenceSummaryRow | undefined => {
      if (!email) return undefined;
      return summaryMap[email.toLowerCase()];
    },
    [summaryMap],
  );

  const value = useMemo<PresenceContextValue>(
    () => ({ presenceMap, summaryMap, myEmail, getStatus, getSummary }),
    [presenceMap, summaryMap, myEmail, getStatus, getSummary],
  );

  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>;
}

// ─── HOOK (back-compat signature) ────────────────────────────────────────

/**
 * Returns presence state. When called inside a PresenceProvider tree (which
 * is the case for all authenticated routes), the args are ignored — the
 * Provider already owns the channel + heartbeats. The args remain in the
 * signature so legacy call sites keep compiling.
 *
 * When no Provider is mounted (anonymous routes), returns a no-op object
 * with everyone reporting "offline".
 */
export function usePresence(userEmail?: string, workspaceId?: string) {
  // userEmail + workspaceId are preserved for back-compat with call sites that
  // pass them. When a PresenceProvider is mounted upstream, both are already
  // known from auth + workspace contexts, so the args are ignored.
  void userEmail;
  void workspaceId;
  const ctx = useContext(PresenceContext);
  if (!ctx) {
    return {
      presenceMap: {},
      summaryMap: {},
      myEmail: "",
      getStatus: (email: string): PresenceStatus => {
        void email;
        return "offline";
      },
      getSummary: (email: string): PresenceSummaryRow | undefined => {
        void email;
        return undefined;
      },
    } satisfies PresenceContextValue;
  }
  return ctx;
}

export function usePresenceContext() {
  return usePresence();
}
