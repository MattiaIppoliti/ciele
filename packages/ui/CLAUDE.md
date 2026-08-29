# packages/ui, `@agent-hub/ui`

Shared primitives (shadcn/ui style, on Base UI) used by every app in the workspace.

## Commands

```bash
pnpm --filter @agent-hub/ui typecheck   # tsc --noEmit
pnpm --filter @agent-hub/ui test        # vitest run
```

**Components here are presentational and have no tests.** The exception is the behaviour this
package owns because it is shared byte-for-byte across apps and therefore cannot live in a
consuming app: `use-resizable-width.ts` and the pure geometry under it. That geometry sits in its
own `.ts` module (`resize-geometry.ts`) precisely so vitest reaches it, since every config here
collects `.test.ts` only, never `.test.tsx`. Component behaviour still belongs in the consuming
app's plain-TS module.

## Conventions

- One primitive per file, kebab-case (`copy-feedback.tsx`), exported from `src/index.ts`.
  A component that isn't in the barrel isn't usable by the apps.
- Deep import paths must be declared in `exports` in `package.json` (currently
  `./use-resizable-width` and `./resize-geometry`). Adding one without the entry breaks the
  consumer's build, and the failure is a `TS2307` at the import, not anything that names the
  exports map.
- `sideEffects: false`: keep modules pure so app bundles can tree-shake.
- React is a **peer** dependency. Never add `react`/`react-dom` to `dependencies` here.
- Styling: Tailwind v4 + plain `Record<Variant, string>` class maps + the local `cn()` from
  `src/cn.ts` (no `cva`).

## Before adding a component

Check whether it already exists here or in `apps/web/src/components/ui/`. A primitive used by
more than one app belongs here; one used by a single app stays in that app.
