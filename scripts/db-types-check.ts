import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

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
} catch {
  console.error("failed to generate fresh types. Check SUPABASE_PROJECT_ID.");
  process.exit(2);
}

if (current !== fresh) {
  console.error("DB types drift detected. Run `npm run db:types` and commit.");
  process.exit(1);
}

console.log("DB types in sync.");
