# Plan: Alex Invite Link Expired — Diagnosis & Resolution

**Date:** 2026-04-23
**Type:** Operational incident diagnosis
**Status:** Resolved (no code changes required)

---

## Requirements Summary

Alex attempted to complete signup via an emailed invite link at smm.ten80ten.com. The login page displayed: "Your invite link has expired or is invalid. Ask an admin to resend your invite." The admin needs to understand what happened and what action to take.

---

## Diagnosis

### What happened

1. Admin sent Alex an invite via `/api/team/invite`
2. The route created an auth user, generated an invite link with a `token_hash`, inserted Alex into `team_members` with `status = 'pending'`, and sent a branded email
3. Alex clicked the invite link after the 24-hour OTP expiry window
4. The `/auth/confirm` route called `supabase.auth.verifyOtp()` — this failed with an expired token error
5. The confirm route redirected to `/?error=invalid_token`
6. `login-screen.tsx:18-30` parsed the `error` query param and displayed the error message
7. The URL was cleared from browser history (`login-screen.tsx:38-47`)

### Root cause

Supabase OTP tokens for invite links expire after 24 hours by default. Alex did not complete the setup flow within that window. No bug — system behaved correctly.

### Relevant files

| File | Role |
|------|------|
| `src/app/auth/confirm/route.ts:28-42` | OTP verification + error redirect |
| `src/components/login-screen.tsx:18-30` | Error message display from URL params |
| `src/app/api/team/resend-invite/route.ts` | Resend flow (delete old user, create fresh, send new email) |
| `src/lib/email-utils.ts` | `buildInviteEmailHtml()` — includes 24-hour expiry warning |

---

## Acceptance Criteria

- [ ] Alex receives a new invite email with a fresh `token_hash`
- [ ] Alex can click the new link and reach `/auth/setup` successfully
- [ ] Alex can set a password and complete profile setup
- [ ] Alex's `team_members` record transitions from `status = 'pending'` to `status = 'active'`
- [ ] No duplicate auth users exist for Alex's email in Supabase

---

## Implementation Steps

### Step 1 — Resend invite (immediate, admin action, no code change)

1. Open the admin team management panel on smm.ten80ten.com
2. Locate Alex in the pending members list
3. Click **Resend Invite**
4. This triggers `POST /api/team/resend-invite` which:
   - Verifies Alex's `team_members` record is still `status = 'pending'` (`resend-invite/route.ts:40-50`)
   - Deletes the old Supabase auth user (`resend-invite/route.ts:52-62`)
   - Creates a fresh auth user with a new temp password (`resend-invite/route.ts:64-72`)
   - Generates a new `token_hash` via `generateLink({ type: "invite" })` (`resend-invite/route.ts:74-88`)
   - Sends a new branded invite email with the fresh link

### Step 2 — Optional: Extend invite expiry in Supabase (no code change)

If 24 hours is too tight for team members to respond:

1. Go to Supabase Dashboard → **Authentication** → **Configuration** → **Email**
2. Set **OTP Expiry** to `259200` (72 hours) or `604800` (7 days)
3. This applies to all new tokens generated after the change

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Resend fails if Alex is no longer `status = 'pending'` | Route validates status before proceeding (`resend-invite/route.ts:40-50`) — will return error if already active |
| Duplicate auth users after resend | Route deletes old auth user before creating new one (`resend-invite/route.ts:52-62`) |
| New invite also expires | Notify Alex to complete setup immediately; optionally extend OTP expiry in Supabase settings |
| Alex uses "Request Access" form instead | That flow inserts a new `signup_requests` row — admin would need to approve it, potentially creating a second `team_members` record for the same email. Instruct Alex not to use "Request Access" — use Resend Invite instead |

---

## Verification Steps

1. Confirm Alex receives a new invite email within 2 minutes of resend
2. Alex clicks the link → should reach `/auth/setup` (not the login page with an error)
3. Alex sets password and name → redirects to dashboard
4. Query `team_members` table: Alex's record should show `status = 'active'`
5. Alex can log in normally via the login page

---

## No Code Changes Required

The error handling pipeline, resend flow, and email expiry warnings are all functioning correctly. This is a pure operational incident.
