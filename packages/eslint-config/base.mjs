import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * Shared flat config for the workspace **packages** (`@agent-hub/core`, `db`,
 * `agent`, `ui`, `charts`).
 *
 * The three apps keep their own configs: they need `eslint-config-next`, and
 * each carries app-specific rules (ADR-0004's per-app posture). This one covers
 * the shared code, which had no lint at all — `turbo run lint` silently skipped
 * every package because none declared a `lint` script.
 *
 * Deliberately close to the recommended sets. The point is to have coverage on
 * shared code, not to relitigate style; anything the formatter or `tsc` already
 * decides is left alone.
 */
export default [
  { ignores: ["dist/**", "node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: { ecmaVersion: "latest", sourceType: "module" },
    },
    rules: {
      // `_`-prefixed args are the repo's existing convention for deliberately
      // unused parameters (adapter methods that must match a signature).
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Tests reach for casts and partial fixtures on purpose.
    files: ["**/*.test.ts", "**/testing/**"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
];
