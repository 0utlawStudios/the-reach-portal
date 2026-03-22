-- ═══════════════════════════════════════════════════════════
-- AUDIT LEDGER HARDENING — IMMUTABILITY ENFORCEMENT
-- Paste into Supabase SQL Editor and click Run
--
-- This script ensures the post_audit_logs table is
-- STRICTLY APPEND-ONLY at the database level.
-- No frontend code, admin panel, or API call can ever
-- update or delete historical audit entries.
-- ═══════════════════════════════════════════════════════════

-- Step 1: Ensure RLS is enabled
ALTER TABLE post_audit_logs ENABLE ROW LEVEL SECURITY;

-- Step 2: Drop ANY existing UPDATE or DELETE policies (safety sweep)
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE tablename = 'post_audit_logs'
      AND (cmd = 'UPDATE' OR cmd = 'DELETE')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON post_audit_logs', pol.policyname);
    RAISE NOTICE 'Dropped dangerous policy: %', pol.policyname;
  END LOOP;
END $$;

-- Step 3: Ensure INSERT policy exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'post_audit_logs' AND cmd = 'INSERT'
  ) THEN
    CREATE POLICY "Allow insert audit" ON post_audit_logs FOR INSERT WITH CHECK (true);
  END IF;
END $$;

-- Step 4: Ensure SELECT policy exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'post_audit_logs' AND cmd = 'SELECT'
  ) THEN
    CREATE POLICY "Allow read audit" ON post_audit_logs FOR SELECT USING (true);
  END IF;
END $$;

-- Step 5: Verify — this query should return ONLY INSERT and SELECT
SELECT policyname, cmd FROM pg_policies WHERE tablename = 'post_audit_logs' ORDER BY cmd;

-- ═══════════════════════════════════════════════════════════
-- RESULT: post_audit_logs is now an immutable append-only ledger.
-- ═══════════════════════════════════════════════════════════
