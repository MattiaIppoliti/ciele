# Platform complexity audit

Baseline: `f7e5203699c5616bb02c3528ea1759c15c112eb8`.

Scope: all 3,161 tracked files and 16 workspace manifests, including hidden
configuration, tests, fixtures, `.mts` scripts, docs, desktop, enterprise code,
workers, deployment tooling, and mirror overlays. This pass concerns complexity
and over-engineering. It does not change product requirements or database policy.

## Confirmed cuts, largest first

Each finding below is implemented in this change.

1. `yagni:` Remove sidebar rename/reorder, optimistic rollback, uncontrolled
   state, and unused resource kinds. All three consumers are controlled
   conversation lists that disabled editing. Keep folder expansion, keyboard
   navigation, marquee labels, reduced motion, and Preview's Pin/Delete menu.
   [ai-sidebar.tsx](../../apps/web/src/components/agents/ai-sidebar.tsx).
2. `delete:` Remove the uncalled chromatic reveal component. Keep the active
   Scritto headline animation and declare its actual props beside it.
   [hero-rolling-word.tsx](../../apps/web/src/components/home/hero-rolling-word.tsx).
3. `delete:` Remove the unimported `NumberTicker` component. Replacement: nothing;
   active counters use the existing motion components. Former path:
   `apps/web/src/components/charts/beui/motion/number-ticker.tsx`.
4. `native:` Replace repeated SVG gradient definitions with CSS radial and linear
   gradients, and share the grid backdrop between both marketing illustrations.
   Preserve their dimensions, stops, opacity, stacking, and hover transitions.
   [visual-backdrops.tsx](../../apps/web/src/components/core/visual-backdrops.tsx).
5. `delete:` Remove `lazyModule` and its isolated tests. Its only code consumer
   was its own test; production uses `createPreloader`. Update the design guide
   to point at that existing implementation. Former path: `apps/web/src/lib/lazy-module.ts`.
6. `delete:` Remove unused `thinking-label-glow`, `eyt-mark`, and `gtry` styles.
   No component, script, fixture, or string reference selects them.
   [globals.css](../../apps/web/src/app/globals.css).
7. `delete:` Remove unused Next.js scaffold assets `file.svg`, `globe.svg`,
   `next.svg`, `vercel.svg`, and `window.svg`. Replacement: nothing; no tracked
   source or configuration references these paths. Former directory: `apps/web/public/`.
8. `delete:` Remove the uncalled `SquiCircleFilterStatic` wrapper. Keep the
   mounted document-wide filter. [skiper63.tsx](../../apps/web/src/components/v1/skiper63.tsx).

## Evidence for retained code

The import and name scans were candidate generators. Whole-tree string searches
confirmed each deletion, including tests, scripts, CSS, fixtures, and docs.
The seeded random generator is used by `.mts` labelling scripts. Renderer and
worker entrypoints, route files, package exports, and mirror overlays have callers
outside ordinary imports. Test harnesses remain because their tests consume them.

Runtime host ports, provider adapters, the two Db implementations, and desktop
setup ports support distinct execution or test environments. Billing caps and
usage-window calculations already have single owners. No direct dependency was
confirmed unused, so no manifest or lockfile changes are required.

## Verification

Initial `pnpm verify` passed: 6,346 passing tests (including cached results for unchanged
workspaces), workspace typechecks, lint, builds, security tests, mirror checks,
boundary checks, documentation checks, deployment checks, and bundle budgets.
The focused chat/loading tests also passed before and after the edits. Lint has
three existing warnings and no errors.

Browser verification ran against the local production build in demo mode.
Teammate history supports folder collapse/expand, arrow-key navigation, selection,
and clearing selection on New chat. Preview's Pin/Delete menu works; deleting
the created test conversation restores the empty state. Marketing backdrops
render in light and dark themes, hover still works, and the Scritto headline cycles.

Independent Standards and Spec reviews found no actionable issues.

PR #1031 integration base: `310e709954f66502fb200efd3daa69ea895e0e7a`.
The combined branch passes the same unmodified gate: 6,103 regular tests and
304 security tests, 6,407 in total. The audit code patch is unchanged after
integration. The line count below excludes this audit report.

net: -1062 lines, -0 deps possible.
