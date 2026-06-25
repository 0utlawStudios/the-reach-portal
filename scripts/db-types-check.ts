import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const path = "src/lib/database.types.ts";
const projectId = process.env.SUPABASE_PROJECT_ID;
const accessToken = process.env.SUPABASE_ACCESS_TOKEN;

if (!projectId || !accessToken) {
  console.warn("Skipping DB type drift check: SUPABASE_PROJECT_ID and SUPABASE_ACCESS_TOKEN are required.");
  process.exit(0);
}

if (!existsSync(path)) {
  console.warn(`Skipping DB type drift check: ${path} is not committed in this project yet.`);
  process.exit(0);
}

const current = readFileSync(path, "utf8").trim();
let fresh = "";

try {
  fresh = execFileSync("supabase", ["gen", "types", "typescript", "--project-id", projectId, "--schema", "public"], {
    env: { ...process.env, SUPABASE_ACCESS_TOKEN: accessToken },
    stdio: ["ignore", "pipe", "ignore"],
  })
    .toString()
    .trim();
} catch {
  console.error("failed to generate fresh types. Check SUPABASE_PROJECT_ID and SUPABASE_ACCESS_TOKEN.");
  process.exit(2);
}

if (current !== fresh) {
  console.error("DB types drift detected. Run `npm run db:types` and commit.");
  process.exit(1);
}

console.log("DB types in sync.");
