import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "migration/**",
    "playwright-report/**",
    "perf/drag-evidence/playwright-results/**",
    "e2e/.auth/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
