# surface-field (vendored)

The Flow Canvas background. Copied from
[angelolibero/surface-field](https://github.com/angelolibero/surface-field) at commit
`0257261ffcffe9cfe61f795745dc4da8e3679922` (v0.1.0), MIT, see `LICENSE`.

Vendored instead of installed because the package is not on a registry: a GitHub install runs its
`prepare` build on every `pnpm install`, which meant allowlisting a third-party build script.

The files are upstream's `src/` with these host adaptations: relative imports drop the `.js`
extension, the worker factory ref updates in a layout effect, and the viewport forwarding effect
depends on the complete viewport prop. The latter two satisfy Ciele's React hooks lint rules
without restarting the renderer for a camera change. Keep these adaptations explicit when syncing.
The full upstream source includes the renderer, DOM adapter, and optional worker support.
Ciele keeps the default main-thread renderer; the Flow bridge does not need a worker to use
this revision. Upstream's controller, viewport, presentation and worker tests run in this
app's vitest suite. The presentation tests cover retained canvas buffers and context recovery.

The app-side integration lives outside this folder: `components/assistant/flow-canvas-field.tsx`
(the React Flow bridge) and `lib/flow-canvas-field.ts` (the geometry and tuning).
