import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Open-core boundary: `src/ee/**` is stripped from the public mirror, which
// overlays an inert `register.ts` stub in its place. Open-source code must
// therefore not depend on anything under it, or the mirrored tree stops
// compiling. The one sanctioned seam is `@/ee/register` (loaded dynamically by
// instrumentation.ts); enterprise capabilities come back through the runtime's
// registry, never through a direct import. Unlike the chat runtime — a package
// whose `exports` map makes deep imports unresolvable — `src/ee` is a plain
// folder behind the `@/` alias, so resolution cannot enforce this and a lint
// rule has to.
const enterpriseModules = {
  group: ["@/ee", "@/ee/*", "!@/ee/register"],
  message:
    "Open-source code must not import enterprise modules (src/ee/**) — they are excluded from the public mirror. Register capabilities through '@/ee/register' and consume them via '@agent-hub/agent'.",
};

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
          patterns: [enterpriseModules],
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
  // Enterprise code may of course import its own modules; every other boundary
  // still applies to it.
  {
    files: ["src/ee/**", "src/app/api/ee/**"],
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
    ignores: ["src/app/api/ee/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [enterpriseModules],
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
