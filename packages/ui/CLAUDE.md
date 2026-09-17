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

Three groups, declared in **`apps/web/src/app/globals.css`** (the source of truth) and repeated in
`apps/docs/src/app/global.css` and the staff console's own stylesheet, because Tailwind resolves
`@theme` per app and a primitive rendered in one of those apps would otherwise lose its surface.
**Add a token to all three or to none.**

- **Surface alphas** `alpha-lighter | alpha-light | alpha-medium | alpha-strong`
  (`bg-`/`border-`/`ring-`). Translucent black, inverted to white in `.dark`. Reach for these for
  any control surface or hairline: a variant written against them keeps its weight over the shell,
  over a card and over a coloured banner, and needs **no `dark:` twin**. A control that paints a
  literal grey (`bg-background`, `border-input`) shows that grey as a patch the moment it lands on
  anything but the one ground it was picked for.
- **Elevations** `shadow-light` (resting lift) and `shadow-strong` (detached layer: popover,
  dropdown, drawer, dialog, drag ghost). Two, not a ramp. `shadow-md`/`-lg`/`-xl` were three
  different answers to the same question and no two floating layers agreed.
- **Tag tints** `tone-<hue>` + `tone-<hue>-ink` for gray/blue/green/amber/red/purple, reached
  through `<Badge tone="…">` rather than by class. A **solid** palette colour is still right for a
  status *dot*: a 6px dot has to carry the state alone and a tint vanishes at that size.

Geometry follows from `--radius` (8px): `rounded-lg` is the control radius, and the xl/2xl steps
scale off the same base. Buttons carry 14px icons, menu rows 16px.

## Before adding a component

Check whether it already exists here or in `apps/web/src/components/ui/`. A primitive used by
more than one app belongs here; one used by a single app stays in that app.
