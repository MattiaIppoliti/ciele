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

## The token set these primitives are written against

Surface alphas, two elevations, the tag tones and the `brand` accent, declared in `apps/web/src/app/globals.css` and
repeated in `apps/docs/src/app/global.css` and the staff console's stylesheet. **Add a token to
all three or to none.** The console shell's own `shell` / `content` / `rail` are the one
exception (`DESIGN.md` §2): no primitive here reads them, so they live in `apps/web` alone. What each token is for, the primitive catalogue and the drift still to
migrate are in the root [`DESIGN.md`](../../DESIGN.md); write a variant here against those
tokens, never against a literal grey or a `dark:` twin.

## Before adding a component

Check whether it already exists here, in `apps/web/src/components/ui/` or `components/motion/` (the table in `DESIGN.md` §3 lists them by role). A primitive used by
more than one app belongs here; one used by a single app stays in that app.
