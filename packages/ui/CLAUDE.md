# packages/ui — `@agent-hub/ui`

Shared primitives (shadcn/ui style, on Base UI) used by every app in the workspace.

## Commands

```bash
pnpm --filter @agent-hub/ui typecheck   # tsc --noEmit
```

No test script — this package is presentational. Behaviour worth testing belongs in the
consuming app's plain-TS module (app vitest configs only pick up `.test.ts`, not `.test.tsx`).

## Conventions

- One primitive per file, kebab-case (`copy-feedback.tsx`), exported from `src/index.ts`.
  A component that isn't in the barrel isn't usable by the apps.
- Deep import paths must be declared in `exports` in `package.json` (currently only
  `./use-resizable-width`). Adding one without the entry breaks the consumer's build.
- `sideEffects: false` — keep modules pure so app bundles can tree-shake.
- React is a **peer** dependency. Never add `react`/`react-dom` to `dependencies` here.
- Styling: Tailwind v4 + `cva` variants + the local `cn()` from `src/cn.ts`.

## Before adding a component

Check whether it already exists here or in `apps/web/src/components/ui/`. A primitive used by
more than one app belongs here; one used by a single app stays in that app.
