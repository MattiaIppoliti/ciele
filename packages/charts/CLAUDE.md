# packages/charts — `@agent-hub/charts`

Chart + animated-number primitives (`motion`, `@number-flow/react`) shared by the Insights
surfaces of every app in the workspace.

## Commands

```bash
pnpm --filter @agent-hub/charts test        # vitest run
pnpm --filter @agent-hub/charts typecheck   # tsc --noEmit
```

## Conventions

- Public surface is `src/index.ts`; the only declared export path is `.`.
- React is a **peer** dependency — never move it into `dependencies`.
- No charting library: these are hand-built SVG/DOM components. Prefer extending one over
  pulling in a dependency (see the "prefers free deps" bias in the root guide).
- Testable logic (scales, tick generation, formatting) lives in `.ts` modules with colocated
  `.test.ts`; the `.tsx` renders stay thin so they need no DOM test environment.
