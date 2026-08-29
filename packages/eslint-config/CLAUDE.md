# packages/eslint-config, `@agent-hub/eslint-config`

The shared ESLint flat config for the workspace **packages** (`core`, `db`, `agent`, `ui`,
`charts`). One import each:

```js
import config from "@agent-hub/eslint-config";
export default config;
```

## Why the apps are not in here

The three apps keep their own `eslint.config.mjs`. They need `eslint-config-next`, and each carries
app-specific rules, `apps/web` bans the browser Supabase client in `src/components/**` and
`src/app/**`. Folding those into a shared config would either import Next into the packages' lint or
push app rules onto packages they do not apply to. ADR-0004's per-app posture is the same reasoning.

## Why this package exists at all

Before it, `turbo run lint` covered **three workspaces**, the apps. None of the packages declared a
`lint` script, so ~20k lines of shared code (the `Db` seam, the whole chat runtime, the domain) were
never linted, and turbo skipped them silently because turbo only runs scripts that exist. The first
run found five dead imports that had been sitting in `packages/db` and `packages/agent`.

## Scope

Deliberately close to `js.configs.recommended` + `typescript-eslint`'s recommended set. This is
coverage on shared code, not a style debate, anything the formatter or `tsc` already decides is
left alone. Two adjustments: `_`-prefixed identifiers are allowed unused (adapter methods that must
match a signature), and tests may use `any` and non-null assertions.

## Why this package declares `typescript`

It never imports it. The devDependency exists so pnpm resolves `typescript-eslint`'s `typescript`
peer from *this* manifest, to the 6.0 API republish, rather than walking up to a consumer workspace
and matching the TypeScript 7 alias by package name. typescript-eslint throws at module load on
7.x, so without that key `pnpm lint` dies with `Cannot read properties of undefined (reading 'Cjs')`
in `typescript-estree`. See the two-TypeScripts bullet in the root [`CLAUDE.md`](../../CLAUDE.md).
