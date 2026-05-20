# Support Center — Optimization + Emoji Picker

Date: 2026-05-20
Scope: `smm.ten80ten.com` Support Center widget (built earlier this session).
Mode: `/plan --direct`

## Requirements Summary

Two asks on top of the shipped Support Center:

1. **Optimize it / make it faster.** The widget currently ships its full UI
   (framer-motion, ticket form, thread view, attachment bar) in the client
   bundle of *every* page, and fires an API call + a DB query + a realtime
   websocket subscription on *every* page load, even when the user never opens
   it. Make the widget near-free until it is actually used.

2. **Add an emoji picker.** Not message reactions. A smiley button on the
   composer opens a small popup grid; tapping an emoji inserts it into the
   text at the caret, the way the iPhone emoji keyboard works. User chose the
   **Quick picker**: ~80 popular emojis + a recents row, one tap to insert.

## Current State (researched)

- `src/components/app-shell.tsx:87` mounts `<SupportWidget />` unconditionally.
- `src/components/support/support-widget.tsx` imports framer-motion,
  `TicketForm`, `ThreadView`, `AttachmentBar`. All of it lands in the shared
  client bundle; `SupportWidget` then returns `null` for superadmin / logged-out
  users, so that JS is shipped for nothing in those cases.
- `src/lib/support/use-support.ts:277-279` — `useEffect` calls `refresh()` as
  soon as `accessToken` exists → one `GET /api/support/threads` per page load
  for every user.
- `use-support.ts:283-313` — a Supabase Realtime channel opens on mount and is
  held for the whole session, regardless of whether the widget is opened.
- `src/lib/support/server.ts:237-249` `resignAttachments` — serial `await`
  loop of `createSignedUrl`, one attachment at a time.
- `api/support/threads/[id]/route.ts:63-67` and `api/support/chat/route.ts:67-71`
  — `for` loop calling `resignAttachments` per message → an N×M serial
  signed-URL waterfall on a media-heavy thread.
- `use-support.ts:76-85` `uploadFiles` — serial `uploadToSignedUrl`, one file
  at a time. `server.ts` `createUploadTargets` / `buildAttachmentsFromClaims`
  — serial per-file storage calls.
- No `next/dynamic` anywhere in the support feature.
- Composers: `thread-view.tsx:181` textarea (chat + ticket reply, also used by
  the admin inbox via the shared `ThreadView`), `ticket-form.tsx:68` textarea
  (issue description). Both are plain controlled `<textarea>`.
- `tw-animate-css@1.4.0` is already a dependency — usable for the trigger's
  entrance without framer-motion.

## Acceptance Criteria

- **AC1** — After `npm run build`, framer-motion is not in the shared client
  chunk via the support widget; the support panel is its own lazily-loaded
  chunk (confirm in the `.next` build output / route chunk list).
- **AC2** — A fresh authenticated page load issues zero `/api/support/*`
  requests until the browser is idle (verify in DevTools Network). The unread
  dot still appears within ~3s of load.
- **AC3** — Opening a thread whose messages carry attachments issues the
  signed-URL calls concurrently (`Promise.all`), not in a serial `await` loop.
- **AC4** — A smiley button sits in the chat/ticket composer and the ticket
  description field. Tapping an emoji inserts it at the caret, preserves the
  text on both sides, and leaves the caret immediately after the emoji.
- **AC5** — Recently used emojis persist across reloads (localStorage) and
  render first in the picker.
- **AC6** — At 375px the picker opens fully on-screen *above* the composer
  (never clipped), every emoji cell is ≥32px, the smiley button has a ≥44px
  tap area.
- **AC7** — First open of the widget is instant on a warm connection (panel
  chunk hover/focus-prefetched from the trigger).
- **AC8** — `npm run typecheck` clean, `npm run lint` 0 new errors, all
  existing tests pass, new tests for the cursor-insert helper + recents pass,
  `npm run build` succeeds.

## Phase 1 — Performance

**1.0** Read `node_modules/next/dist/docs/` for the Next 16 lazy-loading /
`next/dynamic` guide before writing any split (AGENTS.md hard rule — this
Next.js may differ from training data).

**1.1 Split the widget into a light shell + a lazy panel.**
- `support-widget.tsx` (shell, stays mounted in app-shell): renders only the
  small trigger square, owns `useSupport("own")` and the `open` state. The
  trigger uses `tw-animate-css` for its fade/scale-in instead of
  `motion.button` — no framer-motion in this file.
- `support-panel.tsx` (new): every heavy piece — the framer-motion panel,
  tabs, home view, `TicketForm`, `ThreadView` wiring, the "sent" view. The
  shell renders it via `next/dynamic(() => import("./support-panel"),
  { ssr: false })` only while `open` is true. The `support` hook value is
  passed down as a prop so the dot and the panel share one hook instance.

**1.2 Hover/focus-prefetch the panel chunk.** On the trigger's `onMouseEnter`
/ `onFocus`, fire the dynamic `import()` so the chunk is warm before the click
(pattern reused from OneTree Track). Give `next/dynamic` a minimal `loading`
fallback (panel header + spinner) for the cold-cache case.

**1.3 Defer the hook's side effects.** In `use-support.ts`, move the initial
`refresh()` and the realtime `.subscribe()` off synchronous mount onto
`requestIdleCallback` (with a `setTimeout(…, 2000)` fallback for Safari). The
unread dot is then driven by a post-idle fetch rather than blocking TTI; the
idle `refresh()` reconciles anything the slightly-later realtime sub missed.

**1.4 Parallelize server signed-URL work.**
- `resignAttachments` (`server.ts`) — `Promise.all` the per-attachment
  `createSignedUrl`.
- `threads/[id]/route.ts` GET and `chat/route.ts` GET — `Promise.all` the
  per-message resign instead of the serial `for` loop.
- `createUploadTargets` and `buildAttachmentsFromClaims` (`server.ts`) —
  `Promise.all` the per-file `createSignedUploadUrl` / `list` + `createSignedUrl`.

**1.5 Parallelize client uploads.** `uploadFiles` in `use-support.ts` —
`Promise.all` the per-file `uploadToSignedUrl` instead of the serial loop.

**1.6 Cache opened threads (minor).** Keep an in-memory `Map<threadId,
messages>` so re-opening a ticket or switching back to the chat tab renders
instantly from cache while a background refresh runs; realtime already keeps
the active thread fresh.

## Phase 2 — Emoji Picker (Quick picker)

**2.1** `src/lib/support/emoji-data.ts` — a curated array of ~80 popular
emojis (smileys, gestures, hearts, common symbols). Plain Unicode strings, no
image assets. Lives in the panel chunk → zero initial-bundle cost.

**2.2** `src/components/support/emoji-picker.tsx` — a smiley `<button>` that
toggles a popup. The popup is a plain absolutely-positioned `<div>` that opens
**upward** (above the composer) with its own max-height + scroll, dismissed by
an outside `pointerdown` listener and `Escape`. A "Recent" row reads/writes
the last ~8 picks from `localStorage` (lazy `useState` initializer — respects
the `react-hooks/set-state-in-effect` rule). `onPick(emoji)` callback.

**2.3** `insertAtCursor` helper — given the textarea ref, current value, and
an emoji, splice the emoji at `selectionStart`, return the new value, and
restore the caret to just after the inserted emoji (`requestAnimationFrame` +
ref). Pure splice logic unit-tested separately from the DOM caret restore.

**2.4** Wire the picker in:
- `thread-view.tsx` composer — smiley button on the action row next to
  `AttachmentBar`. The admin Support Inbox gets it for free (shared `ThreadView`).
- `ticket-form.tsx` — smiley button on the "Describe the issue" field.

**2.5 Mobile.** Popup opens upward, never clipped inside the full-screen
`h-dvh` mobile panel; emoji cells ≥32px; smiley button ≥44px tap area; verify
at 375px (mobile-optimization hard rule).

## Phase 3 — QA + Ship

- `npm run typecheck`, `npm run lint`, `npm test` (all 157 existing + new).
- New tests: `insertAtCursor` splice logic; emoji recents read/write.
- `npm run build` — confirm the panel chunk split in the output (AC1).
- Manual 375px DevTools pass: trigger, open, both composers, emoji insert.
- Commit, push, deploy to production (standing instruction: always commit,
  push, finish all phases).

## Risks & Mitigations

- **R1 — `next/dynamic` API drift in Next 16.** Read the bundled docs first
  (step 1.0) before implementing the split.
- **R2 — `ssr:false` panel vs the `?support=` deep link.** The shell already
  lazy-inits `open=true` for a deep link; ensure the panel renders whenever
  `open` is true on mount, and re-test the deep-link path.
- **R3 — Deferred realtime delays the live dot by the idle window.**
  Acceptable; the idle `refresh()` reconciles. Documented trade-off — the
  alternative (zero on-load fetch) would kill the proactive unread dot.
- **R4 — Emoji glyphs vary by OS.** Unicode emojis render in the system font —
  the same glyphs the user sees when "typing from iPhone." No sprite sheet, no
  fix needed.
- **R5 — Caret restore in a controlled textarea.** Set state, then restore
  `selectionStart/End` via ref in `requestAnimationFrame`; unit-test the splice.
- **R6 — `react-hooks/set-state-in-effect`.** Emoji recents use a lazy
  `useState` initializer; the idle-defer runs setState inside an idle
  *callback*, not synchronously in the effect body. Both are known-safe.

## Verification Steps

1. `npm run build` → inspect route output, confirm a separate support-panel
   chunk and no framer-motion in the shared chunk (AC1).
2. Fresh load of an authenticated page with DevTools Network open → no
   `/api/support/*` until idle; dot appears ≤3s (AC2).
3. Open a media-heavy ticket → confirm parallel signed-URL requests (AC3).
4. Both composers: insert emojis mid-text, confirm caret + surrounding text
   (AC4); reload, confirm recents persist (AC5).
5. 375px DevTools: picker opens above the composer, fully visible (AC6).
6. Hover the trigger, then click → panel opens instantly (AC7).
7. typecheck / lint / test / build all green (AC8).

## Out of Scope

- Message-level reactions (user explicitly excluded these).
- Changing the Telegram/email notification flow.
- The `auth_users_exposed` advisor (parked for the multi-tenant cutover).
