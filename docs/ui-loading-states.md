# UI loading states (`loading.tsx`)

Every admin route streams behind a Next.js `loading.tsx` boundary (see
[Next.js `loading.js`](https://nextjs.org/docs/app/api-reference/file-conventions/loading)).
The boundary paints instantly on navigation while the destination page's data loads, keeping
the shell chrome (sidebar, top bar, and any section sub-nav) interactive.

## The rule

**A loading skeleton must visually match the page it stands in for.** A generic centered-bars
placeholder that ignores the page's real layout reads as broken, the user sees one shape, then
the layout jumps to a completely different one.

> **When you change a page's UI, update its `loading.tsx` in the same change.**
> If you add/remove/reorder the header toolbar, the card grid, a sub-nav, columns, or the
> overall layout of a page, the matching skeleton must move with it. Treat the skeleton as part
> of the page, not an afterthought.

Concretely, a route's `loading.tsx` should mirror:

- **Container & spacing**: same wrapper classes, padding, and max-width as the page.
- **Layout structure**: same grid/flex shape and column spans (e.g. the Insights 12-column
  metric grid), so nothing shifts when real content swaps in.
- **Chrome that belongs to the segment's `layout.tsx`**: a skeleton placed *inside* a segment
  with its own `layout.tsx` (e.g. `insights/`) renders in the layout's content slot, so the
  section sub-nav stays visible. Place the `loading.tsx` at the segment that owns the layout so
  the sub-nav is not skeletonized away.
- **Prominent blocks**: header title, toolbar buttons, KPI cards, charts, tables, as
  `<Skeleton>` blocks of roughly the right size and position.

Use the shared `@agent-hub/ui` `Skeleton` component. Add `aria-busy="true"` on the
root.

## Where the boundaries live

`apps/web` (the tenant-facing product):

| Route | `loading.tsx` | Mirrors |
|-------|---------------|---------|
| `(admin)/*` (fallback) | `(admin)/loading.tsx` | Generic title + card stack: catch-all for routes without their own |
| `(admin)/insights` | `(admin)/insights/loading.tsx` | Header toolbar + date chip + 12-col metric grid + chart (renders inside `insights/layout.tsx`, so the Insights/Trends/Feedback/Exports sub-nav stays) |
| `(admin)/assistants/[id]` | `(admin)/assistants/[id]/loading.tsx` | Initial Assistant editor / overview center column |
| `(admin)/assistants/[id]/<section>` | Each enabled SETUP section's `loading.tsx` | Destination-owned Assistant section fallback; required so sibling navigation replaces the previous section immediately |

When you build a new page whose layout differs meaningfully from the `(admin)` fallback, add a
route-scoped `loading.tsx` next to its `page.tsx`.

The same rule applies to any other app in the workspace; each app documents its own boundaries in
its README.

## Checklist when touching a page's UI

- [ ] Did the page's layout, header, grid, or key blocks change?
- [ ] Does the nearest `loading.tsx` still resemble the new layout?
- [ ] If the page lives in a segment with its own `layout.tsx`, is the `loading.tsx` scoped so
      the sub-nav / chrome is preserved (not skeletonized)?
- [ ] `aria-busy="true"` on the skeleton root, shared `@agent-hub/ui` `Skeleton` used.
