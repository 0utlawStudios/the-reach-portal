"use client";

import { useEffect, RefObject } from "react";

// Selector for elements that can receive keyboard focus inside a dialog.
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function getFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement
  );
}

/**
 * useFocusTrap — keeps keyboard focus inside a dialog while it is open.
 *
 * On mount it focuses the first interactive element in the dialog. While
 * mounted, Tab / Shift+Tab cycle within the dialog instead of escaping to
 * the page behind it. On unmount, focus is restored to whatever element was
 * focused before the dialog opened.
 *
 * This hook intentionally does NOT handle Escape — each dialog keeps its own
 * existing Escape-to-close handler untouched.
 *
 * Pass `active = false` to keep the hook mounted but inert (used when a
 * dialog component is always rendered but only visible on an `open` flag).
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean = true
): void {
  useEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (!root) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Focus the first interactive element when the dialog opens.
    const focusFirst = () => {
      const focusable = getFocusable(root);
      if (focusable.length > 0) {
        focusable[0].focus();
      } else {
        root.focus();
      }
    };
    // Defer one tick so the dialog DOM is fully painted before focusing.
    const raf = requestAnimationFrame(focusFirst);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const focusable = getFocusable(root);
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = document.activeElement;

      if (e.shiftKey) {
        if (current === first || !root.contains(current)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (current === last || !root.contains(current)) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKeyDown, true);
      // Restore focus to the element that opened the dialog.
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
    };
  }, [ref, active]);
}
