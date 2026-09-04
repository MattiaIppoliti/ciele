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
  `./use-resizable-width`, `./resize-geometry`, `./calendar` and `./feedback`). Adding one without the entry breaks the
  consumer's build, and the failure is a `TS2307` at the import, not anything that names the
  exports map.
- `sideEffects: false`: keep modules pure so app bundles can tree-shake.
- React is a **peer** dependency. Never add `react`/`react-dom` to `dependencies` here.
- Styling: Tailwind v4 + plain `Record<Variant, string>` class maps + the local `cn()` from
  `src/cn.ts` (no `cva`).

## Interface sounds and haptics (`src/feedback/`, spec #817)

The one place `@foleyjs/core` and `web-haptics` are imported, and only through dynamic imports
inside the first user gesture (`import-safety.test.ts` and `dependency-boundary.test.ts` hold
that). `Button` carries `data-foley-press`/`-release`; consuming apps put `data-foley-toggle` on
switches, checkboxes and disclosures and `data-foley-click` on navigation. Foley's own `bind()` is
never called: the binder here reads `aria-checked`/`aria-expanded`, honours `data-foley-silent`,
mute and hidden tabs. The fire/no-fire rule is the pure `decide()` in `policy.ts`, and the
interaction table there is the sound design. A new interaction needs a row, a call site and a
test in the same change.

## Before adding a component

Check whether it already exists here or in `apps/web/src/components/ui/`. A primitive used by
more than one app belongs here; one used by a single app stays in that app.
