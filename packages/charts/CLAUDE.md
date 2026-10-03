# packages/charts, `@agent-hub/charts`

Radial gauges for plan and usage settings, rendered with SVG and pure geometry helpers.

## Commands

```bash
pnpm --filter @agent-hub/charts test        # vitest run
pnpm --filter @agent-hub/charts typecheck   # tsc --noEmit
```

## Conventions

- Public surface is `src/index.ts`; the only declared export path is `.`.
- React is a **peer** dependency, never move it into `dependencies`.
- No charting library: these are hand-built SVG/DOM components. Prefer extending one over
  pulling in a dependency (see the "prefers free deps" bias in the root guide).
- Testable geometry lives in `.ts` modules with colocated
  `.test.ts`; the `.tsx` renders stay thin so they need no DOM test environment.
