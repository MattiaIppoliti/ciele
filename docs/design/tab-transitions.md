# Tab transitions

The shared tab primitives in `components/motion/tabs.tsx` and the `components/ui/tabs.tsx` re-export use the Sliding Panel behavior supplied by the user: simultaneous horizontal travel and opacity, 220 ms, ease `[.23, 1, .32, 1]`. The tab order determines direction. Inactive panels remain mounted to preserve form fields and scroll; they become inert immediately and disappear after their exit. Live reduced-motion changes replace travel with a 150 ms fade.

Keep `TabsContent` panels as direct children of `Tabs`. The root places these siblings in one clipping grid, supporting both natural-height content and a flex body with its own scroll. When a tab changes a filtered body outside the root, use `SlidingPanel` and `useSlidingDirection` around that body. Choose `sizing="flow"` for natural height or the default fill mode for a bounded canvas or scroll area. Filter state should live outside a keyed panel.

Library and Insights route bodies use `RouteSlidingPanel`. Linked tabs use native view-transition snapshots so the previous Next LayoutRouter does not stay mounted. The navigation callback resolves when the new route leaves its skeleton, with a bounded fallback. Browsers without the API retain normal navigation and animate the incoming route. Interrupted navigation skips the old animation and suppresses an obsolete callback. See [the browser API contract](https://developer.mozilla.org/en-US/docs/Web/API/Document/startViewTransition).

The browser regression script `apps/web/scripts/check-sliding-tabs.mjs` checks route direction, local tab switching, form element identity and draft preservation, rapid reversal, inactive panel accessibility and live reduced-motion behavior on localhost.
