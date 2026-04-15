# Legacy SQL files

These files are snapshots of the Ten80Ten SMM Portal schema from before the
Supabase CLI migration system landed in `supabase/migrations/`. They are kept
for historical reference only.

## Do NOT run these against production.

The current production schema is defined by the ordered migrations in
`supabase/migrations/0000_baseline.sql` and later. Running the legacy files
directly would either error (conflicting table definitions) or overwrite
policies and roles that the new migrations have updated.

## What each file was

- `supabase-schema.sql` — the original base schema from 2026-03-23.
- `supabase-setup-all.sql` — one-shot setup script concatenating tables, types, policies, and seed data.
- `supabase-seed.sql` — seed data for new deployments.
- `supabase-avatar-storage.sql` — avatar storage bucket setup.
- `supabase-brand-playbook.sql` — brand_playbook table setup.
- `supabase-audit-source-vault.sql` — post_audit_logs table setup.
- `supabase-harden-audit.sql` — audit table hardening follow-up.

## New workflow

1. Make schema changes as new files in `supabase/migrations/000N_name.sql`.
2. Apply them in order in the Supabase SQL editor (or via `supabase db push` if `SUPABASE_DB_URL` is set).
3. Run `npm run db:types` to regenerate `src/lib/database.types.ts`.
4. CI will refuse to pass if `db:types:check` detects drift.

## When to delete these

After the 30-day legacy overlap window in the 2026-04-15 security remediation
completes, and once `0000_baseline.sql` is confirmed to reflect production
1:1, these files can be removed. Until then, they stay as a recovery reference.
