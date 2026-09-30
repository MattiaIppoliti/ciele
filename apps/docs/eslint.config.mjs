import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { designTokenRules } from "@agent-hub/eslint-config/design-tokens";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    ".source/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // Design tokens (DESIGN.md at the repo root).
  ...designTokenRules({ files: ["src/**/*.{ts,tsx}"] }),
]);

export default eslintConfig;
