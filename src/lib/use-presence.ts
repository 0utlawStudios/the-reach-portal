"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "./supabaseClient";

export type PresenceStatus = "online" | "idle" | "offline";

export interface UserPresence {
  email: string;
  status: PresenceStatus;
  lastSeen: string;
}

const useSupabase = !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  && process.env.NEXT_PUBLIC_SUPABASE_URL !== "https://placeholder.supabase.co");

export function usePresence(userEmail: string) {
  const [presenceMap, setPresenceMap] = useState<Record<string, UserPresence>>({});
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const statusRef = useRef<PresenceStatus>("online");

  const broadcastStatus = useCallback((status: PresenceStatus) => {
    if (!channelRef.current) return;
    statusRef.current = status;
    channelRef.current.track({
      email: userEmail,
      status,
      lastSeen: new Date().toISOString(),
    });
  }, [userEmail]);

  useEffect(() => {
    if (!useSupabase || !userEmail) return;

    const channel = supabase.channel("presence-room", {
      config: { presence: { key: userEmail } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<UserPresence>();
        const map: Record<string, UserPresence> = {};
        for (const [key, entries] of Object.entries(state)) {
          if (entries && entries.length > 0) {
            const latest = entries[entries.length - 1] as unknown as UserPresence;
            map[key] = { email: latest.email || key, status: latest.status || "online", lastSeen: latest.lastSeen || "" };
          }
        }
        setPresenceMap(map);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({
            email: userEmail,
            status: "online" as PresenceStatus,
            lastSeen: new Date().toISOString(),
          });
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.warn("[presence] Channel failed:", status);
          setPresenceMap({});
        }
      });

    channelRef.current = channel;

    // Visibility change — idle when tab is hidden
    const handleVisibility = () => {
      broadcastStatus(document.hidden ? "idle" : "online");
    };
    document.addEventListener("visibilitychange", handleVisibility);

    // Cleanup
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      channel.unsubscribe();
      channelRef.current = null;
    };
  }, [userEmail, broadcastStatus]);

  const getStatus = useCallback((email: string): PresenceStatus => {
    return presenceMap[email]?.status || "offline";
  }, [presenceMap]);

  return { presenceMap, getStatus };
}
