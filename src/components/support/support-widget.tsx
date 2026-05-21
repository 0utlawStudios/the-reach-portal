"use client";

// Featherweight Support Center shell. Mounted on every authenticated page but
// ships almost nothing — just the small trigger square. Support data and
// Realtime stay cold until the user opens it or arrives through a support
// deep link. The heavy panel (framer-motion, the ticket form, the
// conversation view) lives in support-panel.tsx and is code-split:
// it loads only when the widget is first opened. The trigger hover/focus-
// prefetches that chunk so the first open feels instant.

import { useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { LifeBuoy } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useNavigation } from "@/lib/navigation-context";
import { useSupport } from "@/lib/support/use-support";

const SupportPanel = dynamic(() => import("./support-panel").then((m) => m.SupportPanel), {
  ssr: false,
});

/** Warm the panel chunk so the first open is instant. */
function prefetchPanel(): void {
  void import("./support-panel");
}

/** Read the ?support=<threadId> deep-link param, if any. */
function deepLinkThreadId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return new URLSearchParams(window.location.search).get("support");
  } catch {
    return null;
  }
}

export function SupportWidget() {
  const { isAuthenticated, currentUser } = useAuth();
  const { navigateToSupport } = useNavigation();
  const isSuperadmin = (currentUser.role || "").toLowerCase() === "superadmin";

  // Captured once, before the effect below strips the param from the URL.
  const [deepLinkId] = useState<string | null>(() => deepLinkThreadId());
  const [open, setOpen] = useState<boolean>(() => deepLinkId !== null && !isSuperadmin);
  const deepLinkHandled = useRef(false);
  const supportEnabled = !isSuperadmin && (open || Boolean(deepLinkId));
  const support = useSupport("own", { enabled: supportEnabled, realtime: supportEnabled });

  // Deep link: /?support=<threadId>. Strip the param; end users open the
  // widget straight to the thread, the superadmin is routed to the Settings
  // Support Inbox instead.
  useEffect(() => {
    if (deepLinkHandled.current || !isAuthenticated || !deepLinkId) return;
    deepLinkHandled.current = true;
    const params = new URLSearchParams(window.location.search);
    params.delete("support");
    const qs = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
    if (isSuperadmin) navigateToSupport(deepLinkId);
  }, [isAuthenticated, isSuperadmin, deepLinkId, navigateToSupport]);

  // The widget reaches the tech team; the superadmin uses the Settings inbox.
  if (!isAuthenticated || isSuperadmin) return null;

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          onMouseEnter={prefetchPanel}
          onFocus={prefetchPanel}
          aria-label="Get support"
          className="fixed bottom-5 right-5 z-40 flex h-11 w-11 items-center justify-center rounded-2xl border border-gray-200 bg-white/95 text-gray-500 shadow-lg shadow-black/[0.06] backdrop-blur transition-all duration-150 animate-in fade-in zoom-in-95 hover:border-orange-300 hover:text-orange-500 hover:shadow-xl dark:border-white/10 dark:bg-[#16161a]/95 dark:text-gray-400"
        >
          <LifeBuoy className="h-5 w-5" />
          {support.unreadCount > 0 && (
            <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-orange-500 ring-2 ring-white dark:ring-[#0a0a0a]" />
          )}
        </button>
      )}

      {open && (
        <SupportPanel support={support} initialThreadId={deepLinkId} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
