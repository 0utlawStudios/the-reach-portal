-- 0005_role_enum_reconcile.sql
-- Adds missing values to the user_role enum so the DB accepts the role strings
-- the app already writes (superadmin, approver, creative_director, editor, viewer).
-- Idempotent: ADD VALUE IF NOT EXISTS never errors if the value already exists.
-- Part of Workstream C (C4) of the security remediation.
--
-- IMPORTANT: adding enum values must run OUTSIDE a transaction in some Postgres
-- versions. Supabase SQL editor runs each statement separately, so this is fine.
-- If you ever run this migration via psql, use -1 NOT and split into separate calls.

alter type user_role add value if not exists 'superadmin';
alter type user_role add value if not exists 'approver';
alter type user_role add value if not exists 'creative_director';
alter type user_role add value if not exists 'editor';
alter type user_role add value if not exists 'viewer';
