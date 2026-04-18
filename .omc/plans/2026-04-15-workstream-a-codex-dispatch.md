# Workstream A — Foundation: Codex Rescue Dispatch Spec

> **For Codex executor:** this spec is self-contained. You have zero chat context from the author. Read it top to bottom before touching any file.

**Dispatch ID:** ten80ten-remediation-A-2026-04-15
**Parent plan:** `.omc/plans/2026-04-15-security-remediation-plan.md`
**Scope of this dispatch:** Workstream A tasks A1, A3, A5, A6 (foundation layer). Nothing else.
**Not in scope:** A2 (CI), A4 (human secrets audit), B through H.

---

## 1. Mission

You are executing the foundation layer of a security remediation for the Ten80Ten SMM Portal. This dispatch establishes migration infrastructure, a feature-flag table, a structured logger, and fixes 108 ESLint errors. Nothing in Workstreams B through H can start until these land. Ship each task as its own commit.

---

## 2. Pre-Flight Reads (in order, before any edit)

1. `/Users/ace/Documents/CURSOR MAIN/ten80ten-smm-portal/CLAUDE.md`
2. `/Users/ace/Documents/CURSOR MAIN/ten80ten-smm-portal/AGENTS.md`
3. `/Users/ace/.claude/projects/-Users-ace-Documents-CURSOR-MAIN-ten80ten-smm-portal/memory/MEMORY.md`
4. `package.json`
5. `tsconfig.json`
6. `eslint.config.mjs` (or whichever ESLint config exists)
7. `next.config.mjs` (or `.ts`)
8. `.github/workflows/` (all files, read-only)
9. `supabase-schema.sql`, `supabase-setup-all.sql`, `supabase-audit-source-vault.sql` (and any other root-level `supabase-*.sql`)
10. `node_modules/next/dist/docs/` (browse the README and route-handler docs: this is Next.js 16, not Next.js 15 or earlier)
11. `git log --oneline -20` (to match the existing commit message style)

Do NOT skim. You will be asked to cite specifics from these files later.

---

## 3. Non-Negotiable Constraints

### Framework version
- This is Next.js 16 + React Compiler. It is not the Next.js you know. Patterns from your training data may be stale. For every route handler, `next.config`, or file-structure change, read `node_modules/next/dist/docs/` first.

### Permanent data protection rules (project memory)
- NEVER drop, truncate, or overwrite any row in: `audit_log`, `audit_log_legacy`, `team_members`, `placeholder_data`, `brand_playbook`, env-backed tables.
- NEVER run destructive SQL in production. All DB changes go through files under `supabase/migrations/`.
- NEVER amend existing commits. Always create a new commit.
- NEVER skip hooks (`--no-verify` is forbidden).
- NEVER force push.

### v1.0 contract (locked)
- Do NOT change UI layout, component naming, RBAC role label strings, or any API path in `/api/team/*` or `/api/health/*` beyond what a task below explicitly calls for.
- Do NOT modify `n8n-health-check.json`.
- Do NOT rename files that are already committed.

### Style rules from CLAUDE.md
- No em dashes in prose or commit messages. Use commas or periods.
- No banned marketing words in commit messages or comments (see CLAUDE.md banned list).
- No emojis anywhere.
- Short sentences. Active voice.

### Commit protocol
- One task per commit.
- Conventional-commits prefix matching the existing repo style (check with `git log --oneline -20`).
- After each commit, run `git push origin main` (memory rule: always push after every code edit).
- If a pre-commit hook fails, fix the issue and create a NEW commit. Do not amend.

---

## 4. Task A1: Migration Infrastructure

**Goal:** Replace the root-level copy-paste SQL files with a Supabase-CLI-managed `supabase/migrations/` directory, seeded from a baseline of the current schema, plus scripts to generate and verify typed bindings.

**Why it matters:** Every later workstream writes migrations. Without this, none of them can start.

### 4.1 Files

**Create:**
- `supabase/config.toml`
- `supabase/migrations/0000_baseline.sql`
- `scripts/db-types-check.ts`

**Modify:**
- `package.json` (add scripts, add devDependency)
- `.gitignore` (add `.supabase/` and `supabase/.temp/` if absent)

**Do not touch:**
- The existing `supabase-*.sql` files at the repo root. Leave them in place for now. A later task (C8 in the parent plan) will move them into `supabase/legacy/`.

### 4.2 Steps

1. Read the three root-level SQL files and note which tables, columns, indexes, and RLS policies currently exist. Write a summary to `/tmp/current-schema-notes.md` (not committed) for your own use.

2. Install the Supabase CLI:
   ```bash
   npm install --save-dev supabase
   ```
   This adds it to `devDependencies`. Do not add it globally.

3. Initialize the Supabase workspace layout:
   ```bash
   npx supabase init
   ```
   This creates `supabase/config.toml` and `supabase/migrations/`. Do NOT run `supabase start` — that spins up Docker and the project does not use it.

4. Create `supabase/migrations/0000_baseline.sql`. Two paths:
   - **Preferred:** if `SUPABASE_DB_URL` is set in the environment, run `npx supabase db dump --db-url "$SUPABASE_DB_URL" --schema public > supabase/migrations/0000_baseline.sql`. This captures the true production shape.
   - **Fallback:** if that env var is not available, concatenate the three root-level SQL files into `0000_baseline.sql` in this order: `supabase-schema.sql`, `supabase-setup-all.sql`, `supabase-audit-source-vault.sql`. De-duplicate any `create table if not exists` blocks that repeat. Preserve all `create policy` statements verbatim.
   
   Add a header comment at the top of the file:
   ```sql
   -- 0000_baseline.sql
   -- Snapshot of production schema as of 2026-04-15.
   -- Do not modify. New changes go in 0001_*.sql and later.
   ```

5. Add scripts to `package.json`. Merge with existing scripts, do not replace:
   ```json
   "db:diff": "supabase db diff --schema public",
   "db:types": "supabase gen types typescript --project-id \"$SUPABASE_PROJECT_ID\" --schema public > src/lib/database.types.ts",
   "db:types:check": "tsx scripts/db-types-check.ts"
   ```
   If `tsx` is not already a devDependency, install it: `npm install --save-dev tsx`.

6. Create `scripts/db-types-check.ts`:
   ```typescript
   import { readFileSync, existsSync } from "node:fs";
   import { execSync } from "node:child_process";

   const path = "src/lib/database.types.ts";
   if (!existsSync(path)) {
     console.error(`missing ${path}. Run "npm run db:types" and commit.`);
     process.exit(1);
   }
   const current = readFileSync(path, "utf8").trim();
   let fresh = "";
   try {
     fresh = execSync("npm run --silent db:types", {
       stdio: ["ignore", "pipe", "ignore"],
     })
       .toString()
       .trim();
   } catch (err) {
     console.error("failed to generate fresh types. Check SUPABASE_PROJECT_ID.");
     process.exit(2);
   }
   if (current !== fresh) {
     console.error("DB types drift detected. Run `npm run db:types` and commit.");
     process.exit(1);
   }
   console.log("DB types in sync.");
   ```

7. Update `.gitignore` if these entries are missing:
   ```
   .supabase/
   supabase/.temp/
   ```

8. Verify:
   ```bash
   npm run typecheck
   ```
   Must be green. The drift-check script must type-check even though it can only fully run when `SUPABASE_PROJECT_ID` is set.

9. Commit:
   ```
   chore(db): add supabase CLI, baseline migration, and type drift check
   ```
   Then `git push origin main`.

### 4.3 Acceptance (A1)

- `supabase/migrations/0000_baseline.sql` exists and contains the full current schema (all tables, policies, functions present in the three root SQL files, or as dumped from prod).
- `supabase/config.toml` exists.
- `npm run typecheck` passes.
- `scripts/db-types-check.ts` compiles without errors.
- `package.json` has three new scripts: `db:diff`, `db:types`, `db:types:check`.
- One commit on `main`, pushed.

### 4.4 Escalate if

- The production DB URL is not available AND the three root SQL files conflict in a way you cannot resolve (e.g. two different shapes for the same column). Report the conflict and stop.
- `supabase init` fails due to an existing `supabase/` directory. Inspect what is there and report before overwriting.

---

## 5. Task A5: Feature-Flag Table

**Goal:** Ship the `feature_flags` table and a client helper so later workstreams can gate risky cutovers.

**Why it matters:** Workstreams B, C, D, E, F, G, H all rely on named flags. Without this, they cannot ship safely.

### 5.1 Files

**Create:**
- `supabase/migrations/0001_feature_flags.sql`
- `src/lib/flags.ts`

**Modify:** none.

### 5.2 Steps

1. Create `supabase/migrations/0001_feature_flags.sql`:
   ```sql
   -- 0001_feature_flags.sql
   -- Introduces the feature_flags table used to gate risky cutovers in
   -- workstreams B through H. All flags ship disabled.

   create table if not exists feature_flags (
     name text primary key,
     enabled boolean not null default false,
     metadata jsonb,
     updated_at timestamptz not null default now()
   );

   insert into feature_flags (name, enabled) values
     ('rls_v2', false),
     ('server_auth_v2', false),
     ('server_rpc_writes', false),
     ('drive_auth_v2', false),
     ('publish_v2', false),
     ('media_v2', false),
     ('audit_v2', false),
     ('content_validation_v2', false)
   on conflict (name) do nothing;

   alter table feature_flags enable row level security;

   drop policy if exists "feature_flags_read" on feature_flags;
   create policy "feature_flags_read" on feature_flags
     for select using (true);
   ```

2. Create `src/lib/flags.ts`:
   ```typescript
   import { supabase } from "./supabaseClient";

   export type FlagName =
     | "rls_v2"
     | "server_auth_v2"
     | "server_rpc_writes"
     | "drive_auth_v2"
     | "publish_v2"
     | "media_v2"
     | "audit_v2"
     | "content_validation_v2";

   type CacheEntry = { value: boolean; at: number };
   const cache = new Map<FlagName, CacheEntry>();
   const TTL_MS = 30_000;

   export async function isFlagOn(name: FlagName): Promise<boolean> {
     const cached = cache.get(name);
     if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
     const { data, error } = await supabase
       .from("feature_flags")
       .select("enabled")
       .eq("name", name)
       .maybeSingle();
     if (error) {
       console.error("flag read failed", name, error);
       return false;
     }
     const value = Boolean(data?.enabled);
     cache.set(name, { value, at: Date.now() });
     return value;
   }

   export function invalidateFlagCache(name?: FlagName) {
     if (name) cache.delete(name);
     else cache.clear();
   }
   ```

3. Verify:
   ```bash
   npm run typecheck
   npm run lint -- src/lib/flags.ts
   ```
   Both must be green.

4. Commit:
   ```
   feat(flags): add feature_flags table and isFlagOn helper
   ```
   Then `git push origin main`.

### 5.3 Acceptance (A5)

- `supabase/migrations/0001_feature_flags.sql` exists with all 8 flags seeded.
- `src/lib/flags.ts` exists with the `FlagName` union and `isFlagOn` helper.
- `npm run typecheck` passes.
- `npm run lint -- src/lib/flags.ts` returns 0 errors.
- One commit, pushed.

### 5.4 Escalate if

- `src/lib/supabaseClient.ts` does not export a named `supabase` object. In that case, read the file, match the existing export shape, and report before writing.

---

## 6. Task A6: Structured Logger

**Goal:** Ship `src/lib/logger.ts` with a small structured JSON logger and a correlation-id helper. Workstream B onward uses it on every new route.

### 6.1 Files

**Create:** `src/lib/logger.ts`.

**Modify:** none.

### 6.2 Steps

1. Create `src/lib/logger.ts`:
   ```typescript
   export type LogLevel = "debug" | "info" | "warn" | "error";

   export type LogFields = {
     route?: string;
     correlation_id?: string;
     user_id?: string;
     workspace_id?: string;
     [key: string]: unknown;
   };

   function emit(level: LogLevel, message: string, fields: LogFields = {}) {
     const line = {
       level,
       message,
       ts: new Date().toISOString(),
       ...fields,
     };
     const out = JSON.stringify(line);
     if (level === "error") console.error(out);
     else if (level === "warn") console.warn(out);
     else console.log(out);
   }

   export const log = {
     debug: (msg: string, fields?: LogFields) => emit("debug", msg, fields),
     info: (msg: string, fields?: LogFields) => emit("info", msg, fields),
     warn: (msg: string, fields?: LogFields) => emit("warn", msg, fields),
     error: (msg: string, fields?: LogFields) => emit("error", msg, fields),
   };

   export function newCorrelationId(): string {
     if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
       return crypto.randomUUID();
     }
     return `cid-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
   }
   ```

2. Verify:
   ```bash
   npm run typecheck
   npm run lint -- src/lib/logger.ts
   ```

3. Commit:
   ```
   feat(logger): add structured logger and correlation id helper
   ```
   Then `git push origin main`.

### 6.3 Acceptance (A6)

- `src/lib/logger.ts` exists.
- `npm run typecheck` passes.
- `npm run lint -- src/lib/logger.ts` returns 0 errors.
- One commit, pushed.

---

## 7. Task A3: Fix 108 ESLint Errors

**Goal:** Drive `npm run lint` from 108 errors to 0 errors and 0 warnings without a single mass rule-disable, without refactoring beyond the fix, and without breaking any of the 7 hot paths.

**Why it matters:** CI cannot enforce quality while 108 errors exist. This task is the largest in the dispatch. Take it slowly.

### 7.1 Pre-flight

1. Capture the baseline:
   ```bash
   npm run lint 2>&1 | tee /tmp/lint-baseline.txt
   ```

2. Group errors by rule. Expected categories based on the parent review:
   - React Compiler hook errors (`react-hooks/*`, `react-compiler/*`)
   - Explicit `any` (`@typescript-eslint/no-explicit-any`)
   - Raw `<a>` navigation (`@next/next/no-html-link-for-pages`)
   - Forbidden `require()` (`@typescript-eslint/no-require-imports`)

3. Before fixing, look at three hot-path files to understand the patterns in use:
   - `src/components/app-shell.tsx`
   - `src/lib/pipeline-context.tsx`
   - `src/lib/navigation-context.tsx`

### 7.2 Fix rules (apply per error, not per file)

- **React hooks / React Compiler errors.** Hooks must be called unconditionally at the top of the component in the same order every render. If a conditional hook exists, refactor so the hook is called every time and the branch happens inside the handler, or extract a subcomponent. Never wrap a hook in an `if`.
- **`@typescript-eslint/no-explicit-any`.** Replace `any` with the actual type. If the type is genuinely unknown at the boundary, use `unknown` and narrow with `typeof`/`instanceof`/type guards. For Supabase query results, use the types from `src/lib/database.types.ts` if present, or define a local `type` for the row shape.
- **`@next/next/no-html-link-for-pages`.** Replace `<a href="/foo">` with `<Link href="/foo">` from `next/link`. Read `node_modules/next/dist/docs/` for the Next.js 16 navigation guidance before touching any route.
- **`@typescript-eslint/no-require-imports`.** Replace `const x = require("y")` with `import x from "y"` at the top of the file, or `const x = await import("y")` inside an async function if dynamic is required. Do not add `esModuleInterop` flags or change `tsconfig.json`.

### 7.3 Process

1. Fix one file at a time. After each file, run:
   ```bash
   npm run lint -- <file path>
   ```
   Confirm the file is clean before moving on.

2. Do NOT:
   - Add `/* eslint-disable */` at the top of any file.
   - Use `// eslint-disable-next-line` without a `-- reason` suffix.
   - Refactor beyond the fix.
   - Rename files.
   - Change component props, function signatures, or public exports unless the ESLint error directly requires it.
   - Touch `n8n-health-check.json`, `.md` files, `.sql` files, or anything under `migration/` (the uncommitted directory).

3. If an error genuinely cannot be fixed without behavior change, add a per-line disable with a reason:
   ```typescript
   // eslint-disable-next-line @typescript-eslint/no-explicit-any -- third-party payload shape, fix in workstream F
   const payload: any = raw;
   ```
   This should happen fewer than 5 times across the whole task. If you find yourself adding more, stop and escalate.

4. After every ~20 errors fixed, run the full suite to confirm no regression:
   ```bash
   npm run lint
   npm run typecheck
   ```

### 7.4 Hot-path smoke (required before commit)

After all errors are cleared, start the dev server and manually walk these 7 paths. You cannot commit this task until all 7 are confirmed working without console errors.

```bash
npm run dev
```

1. Dashboard: log in → home loads.
2. Pipeline: open the kanban view, scroll through stages.
3. Asset review drawer: open a post, drawer opens, tabs work.
4. Create post modal: open, type a title, close.
5. Media page: loads, thumbnails render.
6. Settings page: loads, tabs work.
7. Team page: loads, member list renders.

If any path breaks, identify which fix caused the regression, revert that specific fix, and either (a) find a different way to satisfy the rule or (b) escalate with the file and rule name.

### 7.5 Commit strategy

Commit in logical chunks by rule category, not all 108 in one commit. Example sequence:

```
fix(lint): resolve react hooks violations in pipeline-context and navigation-context
fix(lint): replace explicit any with typed payloads in health-check routes
fix(lint): replace raw anchor tags with next/link in app-shell and nav
fix(lint): replace require imports with esm in settings-page and audit helpers
```

Each commit gets pushed immediately after.

### 7.6 Acceptance (A3)

- `npm run lint` returns 0 errors and 0 warnings.
- `npm run typecheck` returns 0 errors.
- Manual smoke: all 7 hot paths render without console errors.
- No file has a top-of-file `eslint-disable`.
- Fewer than 5 per-line disables across the whole task, each with a `-- reason` suffix.
- Commits are grouped by rule category, not dumped as one.

### 7.7 Escalate if

- A fix for one rule breaks another rule in a way that cannot be resolved without a behavior change.
- A hot-path breaks and the cause is not obvious.
- The lint baseline is higher than 108 (e.g. recent commits added more errors). Report the new total and proceed.
- The lint baseline is lower than expected (e.g. 50). Report and proceed.

---

## 8. Final Gate for This Dispatch

Before declaring Workstream A done, run this checklist and report the output of each command.

```bash
git log --oneline -10
npm run lint
npm run typecheck
ls supabase/migrations/
ls src/lib/flags.ts src/lib/logger.ts
cat supabase/migrations/0000_baseline.sql | head -5
cat supabase/migrations/0001_feature_flags.sql | head -10
```

All of the following must be true:

- `git log` shows at least 4 commits (A1, A5, A6, and at least one A3 commit) on `main`, pushed to origin.
- `npm run lint` shows 0 errors, 0 warnings.
- `npm run typecheck` shows 0 errors.
- `supabase/migrations/` contains `0000_baseline.sql` and `0001_feature_flags.sql`.
- `src/lib/flags.ts` and `src/lib/logger.ts` both exist.
- The two migration files open and show the expected headers.

---

## 9. Report-Back Template

When done (or blocked), reply with this template filled in. Do not add extra sections.

```
## Workstream A Execution Report

Commits (git log --oneline -10):
<paste>

npm run lint:
<paste the final line, should be "0 errors, 0 warnings" or equivalent>

npm run typecheck:
<paste the final line>

Files verified:
- supabase/migrations/0000_baseline.sql: <exists | missing>
- supabase/migrations/0001_feature_flags.sql: <exists | missing>
- src/lib/flags.ts: <exists | missing>
- src/lib/logger.ts: <exists | missing>
- scripts/db-types-check.ts: <exists | missing>

Hot-path smoke (manual, 7 paths):
- Dashboard: <pass | fail>
- Pipeline: <pass | fail>
- Asset review drawer: <pass | fail>
- Create post modal: <pass | fail>
- Media page: <pass | fail>
- Settings page: <pass | fail>
- Team page: <pass | fail>

Escalations or skipped items:
<list with reason, or "none">

Notes:
<anything unexpected>
```

---

## 10. Out of Scope for This Dispatch (Do Not Touch)

- RLS policy rewrites (Workstream C).
- Server-side auth rewrite (Workstream B).
- API route rewrites (Workstream D).
- Google Drive changes (Workstream E).
- Publish queue / OAuth accounts (Workstream F).
- Media lifecycle, rate limiting, audit v2, health probes (Workstream G).
- Platform validators, timezone UI (Workstream H).
- CI workflow changes (Workstream A2, will ship in a separate dispatch after this one lands).
- Secret rotation (Workstream A4, human task).
- Introducing Jest, Vitest, Playwright, or any new test runner (A3 uses existing tools only).
- Moving or deleting any `supabase-*.sql` file at the repo root (C8 in the parent plan handles this later).

If a task in this dispatch seems to require one of the above, stop and escalate.

---

## 11. Author Contact (for escalation)

Escalate to the human operator via the chat. Include:
1. Which task (A1 / A3 / A5 / A6).
2. Exact file and line.
3. The rule or error message.
4. What you tried.
5. Why you are stopping instead of proceeding.

Do not guess. Do not bypass. Do not mass-disable.
