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
    "next-env.d.ts",
  ]),
  // The chat runtime's module boundary is no longer enforced here. It used to be
  // a `no-restricted-imports` pattern over `@/lib/runtime/*`; the runtime is now
  // the `@agent-hub/agent` package, whose `exports` map declares exactly three
  // entry points, so a deep import into its internals does not resolve at all —
  // in tsc or in the bundler. Resolution replaced the rule and closed a hole it
  // had: the old single-segment glob never matched `@/lib/runtime/agentic-search/*`.
  // See ADR-0018.

  // Authentication clients are server-only: session mutation goes through a
  // Server Action or the cookie-scoped server client.
  {
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@supabase/ssr",
              importNames: ["createBrowserClient"],
              message:
                "Authentication clients are server-only. Use the cookie-scoped server client from a Server Action or Route Handler.",
            },
          ],
        },
      ],
    },
  },
  // No browser Supabase client may appear in UI or route code at all.
  {
    files: ["src/components/**", "src/app/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@supabase/ssr",
              importNames: ["createBrowserClient"],
              message: "Authentication is server-only; do not create a browser Supabase client.",
            },
            {
              name: "@supabase/supabase-js",
              importNames: ["createClient"],
              message: "Authentication is server-only; do not create a browser Supabase client.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
