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
  // Runtime module boundary (ADR-0005): the chat runtime is a deep, gray-box
  // module. Outside code goes through its public interface — `@/lib/runtime`
  // (server) or `@/lib/runtime/client` (client) — never its internals. This
  // keeps the module navigable (one interface at the top) and lets its guts
  // change freely behind locked behavior.
  {
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/lib/runtime/*", "!@/lib/runtime/client"],
              message:
                "Import the runtime module's public interface from '@/lib/runtime' (server) or '@/lib/runtime/client' (client), not its internals. See ADR-0005.",
            },
          ],
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
  // Inside the runtime folder, files compose freely across internals — the
  // boundary only applies to consumers outside the module.
  {
    files: ["src/lib/runtime/**"],
    rules: { "no-restricted-imports": "off" },
  },
  // Session mutation is server-only. UI and route callers use server actions
  // or the cookie-scoped server module; no browser Supabase client may appear.
  {
    files: ["src/components/**", "src/app/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/lib/runtime/*", "!@/lib/runtime/client"],
              message:
                "Import the runtime module's public interface from '@/lib/runtime' (server) or '@/lib/runtime/client' (client), not its internals. See ADR-0005.",
            },
          ],
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
