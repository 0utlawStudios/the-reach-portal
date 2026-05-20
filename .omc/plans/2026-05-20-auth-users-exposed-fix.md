# Security Advisor: `auth_users_exposed` — Analysis & Fix Options

**Date:** 2026-05-20
**Project:** Ten80Ten SMM Portal — Supabase `lczmgquuzuqhalasjnip`
**Severity:** CRITICAL (Supabase advisor, dated 17 May 2026)
**Status:** Options for Aldridge to choose. Nothing applied yet.

---

## 1. What `auth_users_exposed` means

A Postgres **view** in the API-exposed `public` schema references `auth.users` (the Supabase Auth table holding emails, hashed passwords, phone numbers, sign-in timestamps). By default a view runs with its **owner's** permissions, not the caller's — so a `public` view on `auth.users` re-exposes that data through the PostgREST API to whoever the view is granted to.

This is **not caused by the Support Center work.** The advisor email is dated 17 May; the Support Center migration (0027) shipped 20 May and creates only tables, no views. The two offending views predate it.

## 2. What is actually exposed (confirmed live)

Two views, both granted to **`anon, authenticated`** — `anon` is the public key embedded in the browser bundle, so this is readable by **anyone on the internet**:

| View | Migration | Leaks |
|---|---|---|
| `v_user_presence_summary` | 0024 | Every team member's **name, email, auth user id, and last sign-in time**. `au.last_sign_in_at` is selected straight into the output. |
| `v_audit_log_with_actor` | 0025 | The **entire `audit_log_v2`** — every workspace, every action, every metadata blob. The view runs as owner, so `audit_log_v2`'s row-level security is **bypassed**. |

Neither view sets `security_invoker`, so both run as the owner and bypass RLS. Anyone with the public anon key can `GET /rest/v1/v_user_presence_summary` and pull the full staff directory.

**App usage** (so a fix does not break the portal):
- `v_audit_log_with_actor` — `src/lib/audit.ts` (the Settings → Audit Logs tab, client-side, as `authenticated`).
- `v_user_presence_summary` — `src/lib/use-presence.tsx` (client-side) and `src/app/api/presence/diag/route.ts` (server, service-role).

`team_members` has **no `user_id` column** — the views join `auth.users` only to bridge `auth-id ↔ email ↔ team_members`.

## 3. Fix options

### Option 1 — Immediate stopgap: revoke `anon`
```sql
revoke select on public.v_audit_log_with_actor   from anon;
revoke select on public.v_user_presence_summary  from anon;
```
- **Effect:** kills the public exposure now. An attacker would need a valid portal login.
- **Effort:** ~2 minutes, fully reversible, no app impact (the app uses `authenticated`, not `anon`).
- **Limit:** the views still reference `auth.users` and are still readable by any logged-in user, so the advisor may keep warning. This is a stopgap, not the cure.

### Option 2 — Full fix (recommended): one migration `0028_secure_actor_views.sql`
1. Add an additive `user_id uuid` column to `team_members`, backfilled once from `auth.users` (the backfill runs inside the migration, a privileged context — not a persistent exposure).
2. Rewrite `v_audit_log_with_actor` to drop the `auth.users` subquery. `actor_name` already resolves from `metadata.user_name`, which migration 0025 backfilled and the trigger keeps populating — the `auth.users` fallback is near-dead weight.
3. Rewrite `v_user_presence_summary` to join `team_members.user_id → user_presence.user_id` directly. Drop the `auth_last_sign_in` column (`best_known_seen` keeps working from presence + audit activity).
4. Set `security_invoker = true` on both views so RLS on the underlying tables is enforced — this also closes the cross-workspace audit-log leak.
5. `revoke select ... from anon`.
- **Effect:** clears the advisor fully, enforces RLS, no app code changes (view names and columns the app reads stay the same).
- **Effort:** ~30-45 minutes, one migration, low risk.
- **Trade-off:** `v_user_presence_summary` loses the `last_sign_in_at` input to "last seen" — presence and audit activity remain.

### Option 3 — Drop the views, resolve in app code
Drop both views; have `audit.ts` query `audit_log_v2` directly (RLS applies) and resolve names from the already-loaded `team-context`; same for presence.
- **Effect:** most RLS-pure, no views at all.
- **Effort:** larger — rewrites `audit.ts` and `use-presence.tsx`.

## 4. Recommendation

Apply **Option 1 now** to stop the active public leak, then ship **Option 2** as migration `0028` for the permanent fix. Option 3 is cleaner in theory but costs more app churn for little extra benefit over Option 2.

Both fixes are independent of the Support Center and can ship separately.

---

## 5. Open question for Aldridge

Which option do you want? If Option 1 + 2, say so and the stopgap can be applied immediately (it is reversible and does not touch app code), with the `0028` migration to follow.
