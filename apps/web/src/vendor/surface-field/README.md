# surface-field (vendored)

The Flow Canvas background. Copied from
[angelolibero/surface-field](https://github.com/angelolibero/surface-field) at commit
`414fe0f800c688e7a81649f4aa15fe8f793c1890` (v0.1.0), MIT, see `LICENSE`.

Vendored instead of installed because the package is not on a registry: a GitHub install runs its
`prepare` build on every `pnpm install`, which meant allowlisting a third-party build script.

The files are upstream's `src/` unchanged except for one thing: relative imports drop the `.js`
extension, matching the rest of this app. Keep it that way so a future sync is a plain copy.
Upstream's own tests (`controller.test.ts`, `viewport.test.ts`) run in this app's vitest suite.

The app-side integration lives outside this folder: `components/assistant/flow-canvas-field.tsx`
(the React Flow bridge) and `lib/flow-canvas-field.ts` (the geometry and tuning).
