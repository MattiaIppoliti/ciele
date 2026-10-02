# Empty states

Ciele uses the [Arc UI Empty state](https://uiarc.dev/components/empty-state),
adapted from its [official registry source](https://uiarc.dev/r/empty-state.json).
The original free component is MIT licensed. Its copyright and full license are
in `apps/web/src/components/arc/empty-state/empty-state.LICENSE`.

The source component keeps Arc's declared API: `title`, `description`, `icon`,
`action`, `className`, and `label`. The existing `ui/empty-state` adapter retains
Ciele's compact size and children-as-actions convention and supplies a region
label from the title. It uses existing theme colors, Lucide, Motion, and the
shared layout/content springs. No dependency was added.

Titles and descriptions rise and crossfade in place. Outgoing copy is hidden
from assistive technology. The icon changes only when its component type changes.
One ResizeObserver springs copy height after a prop change, then restores natural
height so viewport resizing and focus rings work normally. Reduced motion uses
short fades and immediate height changes; the introductory icon animation stops.
Actions wrap and remain native keyboard-accessible controls.

The shared adapter covers existing empty tables, library documents, Help Desks,
Inbox, Knowledge, and Improvements. Additional integrations cover search results,
conversation/history panes, groups, task details, routines, projects, goals,
Eval runs, Insights charts, invoice history, memories, and application imports.
Loading skeletons, extraction progress, retry errors, and specialized chat
welcome screens retain their existing treatment. Existing edit permissions still
control create/extract actions.

A native table marked `empty` fills its available width and hides column chrome.
Stored column widths and resize controls return with the data. A filtered Library
list offers Clear filters instead of directing the user to create a source.

## Verification

Run against the local demo server:

```sh
EMPTY_STATE_BASE_URL=http://localhost:3001 node apps/web/scripts/check-empty-states.mjs
```

The browser check covers assistant search recovery, Inbox reset, filtered native
tables at desktop/tablet/mobile widths, theme appearance, and client errors.
During implementation a temporary parent changed the source component's props
to verify retained DOM identity, intermediate spring heights, outgoing copy's
accessibility, rapid reversal, icon stability, and live reduced motion. That
fixture is not shipped.
