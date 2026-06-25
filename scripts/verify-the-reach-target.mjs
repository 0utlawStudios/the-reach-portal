import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const expected = {
  packageName: "the-reach-portal",
  vercelProject: "the-reach-portal",
  productionHost: "thereach.ten80ten.com",
};

const forbiddenPatterns = [
  /https:\/\/smm\.ten80ten\.com/i,
  /\bsmm\.ten80ten\.com\b/i,
  /\bten80tensmm\b/i,
  /https:\/\/reach\.ten80ten\.com/i,
  /\breach\.ten80ten\.com\b/i,
];

const scanRoots = [
  "package.json",
  "playwright.config.ts",
  "vercel.json",
  ".github",
  "src",
  "e2e",
  "n8n",
  "n8n-health-check.json",
  "supabase/config.toml",
];

const ignored = new Set([
  "src/lib/social-profiles.ts",
]);

function readJson(path) {
  return JSON.parse(readFileSync(join(root, path), "utf8"));
}

function readJsonIfExists(path) {
  try {
    return readJson(path);
  } catch {
    return null;
  }
}

function fail(message) {
  console.error(`[verify-the-reach-target] ${message}`);
  process.exitCode = 1;
}

function warn(message) {
  console.warn(`[verify-the-reach-target] ${message}`);
}

function walk(path, files = []) {
  const abs = join(root, path);
  let st;
  try {
    st = statSync(abs);
  } catch {
    return files;
  }
  if (st.isFile()) {
    files.push(path);
    return files;
  }
  for (const entry of readdirSync(abs)) {
    if (entry === "node_modules" || entry === ".next" || entry === "coverage") continue;
    walk(join(path, entry), files);
  }
  return files;
}

const pkg = readJson("package.json");
if (pkg.name !== expected.packageName) {
  fail(`package.json name must be ${expected.packageName}, got ${pkg.name || "(missing)"}`);
}
if (!pkg.scripts?.["e2e:prod"]?.includes(expected.productionHost)) {
  fail(`package.json e2e:prod must target ${expected.productionHost}`);
}

const vercel = readJsonIfExists(".vercel/project.json");
const vercelProjectName = vercel?.projectName || process.env.VERCEL_PROJECT_NAME || "";
if (vercelProjectName) {
  if (vercelProjectName !== expected.vercelProject) {
    fail(`Vercel project must be ${expected.vercelProject}, got ${vercelProjectName}`);
  }
} else if (process.env.CI) {
  fail(`VERCEL_PROJECT_NAME must be set to ${expected.vercelProject} in clean CI checkouts`);
} else {
  warn(`Skipping Vercel project link check because .vercel/project.json and VERCEL_PROJECT_NAME are absent`);
}

const files = scanRoots.flatMap((path) => walk(path));
for (const file of files) {
  const rel = relative(root, join(root, file));
  if (ignored.has(rel)) continue;
  const text = readFileSync(join(root, file), "utf8");
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(text)) {
      fail(`forbidden old target found in ${rel}: ${pattern}`);
    }
  }
}

if (!process.exitCode) {
  console.log(`[verify-the-reach-target] OK: active targets point at ${expected.productionHost}`);
}
