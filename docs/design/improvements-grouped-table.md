# Improvements grouped table

The Improvements list reconstructs the visible behavior of
[Kobra Grouped Table](https://kobra.systems/components/grouped-table), as requested
by its author. The source panel was gated; no gated source was retrieved or copied.
The reference was studied through the rendered preview, its resize handles and
Inspect tool. This change affects Improvements only; the shared admin tables
retain their native column layout.

## Observed reference

- Rows are 44 px tall, with 20 px horizontal padding and rounded hover surfaces.
- At 1024 px, the row has priority, title, identifier, label, estimate, date and
  people columns. The first title's measured cell is 424 × 20 px.
- At 800 px, the label column disappears and the other columns remain aligned.
- At 650 px, identifier and estimate join the title in an inline cluster; date
  and people stay at the right. Shorter rows use less space for the cluster.
- At 550, 450 and 350 px, gaps narrow continuously. Long rows retain their
  intrinsic width instead of squeezing text; overflow must stay scrollable.
- Group bars have a count and a collapse control. The frame exposes width and
  height resize edges.

The rendered classes expose container thresholds of 768 and 896 px. CSS
transitions on sampled reference rows were zero-duration; exact reference spring
parameters were unavailable. Ciele therefore uses its own interruptible Motion
spring (stiffness 420, damping 28, mass 0.8) for field position changes and group
collapse, with immediate positioning when reduced motion is enabled.

## Integration

The title opens an Improvement task beside the list, and its native URL remains
available for modified clicks. Identifiers use the improvement sequence and
status color. Message counts replace issue estimates; priority remains visible.
Tags occupy the optional label column and stay in the accessible row description
when that column is absent. Dates show the due date when present, otherwise the
creation date. Avatars use the existing member identity renderer.

The board retains filters, exports, lane pagination, context menus, optimistic
status changes, native drag-and-drop and Kanban. Resizing uses pointer capture
and tracks the pointer directly. Each edge supports arrow keys, Shift for larger
steps, Home/End and double-click reset. Dimensions stay within the available
panel; minimums are 320 px wide and 240 px tall, capped by the available space.

## Task panel

The task shares the list's rounded `bg-card` material. Opening reserves space in
normal layout instead of covering the list. The list therefore responds through
its existing width observer and field position springs. The panel uses the chat
preview's `SPRING_UNFOLD` (0.5 seconds, bounce 0.28) for opening, closing and full
screen; pointer resizing follows the pointer without animation. Its shared resize
handle supports keyboard resizing and keeps at least 320 px for the list.

Full screen keeps the same editor mounted, including its local field state, and
returns to the previous split width. Below 800 px of workspace width the task
fills the workspace automatically. Focus is trapped only in the full-width task;
the docked list remains keyboard-accessible. Escape and Close return to the list.
Reduced motion disables panel and row springs.

## Validation

Run `node apps/web/scripts/check-improvement-grouped-table.mjs` against the local
demo. It exercises pointer resize at 1024, 800, 650, 550, 450 and 350 px, then
widens again; checks retained fields, row alignment and overflow reachability;
samples intermediate spring positions; and checks keyboard sizing, collapse,
drawer navigation, search, Kanban and reduced motion.

The same browser check verifies matching card color, rounded corners, actual list
shrinkage without overlap, split dragging, full screen and restoration, editor
identity, and the compact task at a 390 px viewport.
