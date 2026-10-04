"use client";

import type { Alert } from "@agent-hub/core";
import type { ChannelMention } from "@ciele/ops";
import { IngestionActivityCard } from "@/components/notifications/ingestion-activity-card";
import { NotificationCenter } from "@/components/notifications/notification-center";
import { RIGHT_RAIL_TRANSITION_VAR } from "@/components/shell/right-rail";

/**
 * The bottom-right corner, and everything that floats in it.
 *
 * Two occupants now: the notification banner (alerts and mentions) above
 * the ingestion activity card (a crawl or an Import in flight). They share one
 * container so neither has to know the other's height, and so the corner has
 * one owner of its inset rather than two that drift apart.
 *
 * That order is forced, not aesthetic. The banner is a stack that fans out
 * *upward* from its own footprint, overflowing whatever sits above it, so it
 * has to be the topmost occupant or it expands over its neighbour. The column
 * is bottom-anchored, so both grow upward into empty space.
 *
 * From `md` up the inset is measured from the workspace's right rail rather
 * than from the viewport: a docked live preview is user-resizable, and floating
 * over it hid the panel's composer. `--right-rail-width` is 0 wherever the rail
 * is empty, and the offset starts at `md` because that is the breakpoint at
 * which the rail's panel enters the flow at all. Raising z-index instead would
 * have hidden the alerts, which is the wrong way round: an active alert has to
 * stay readable.
 *
 * The offset is a `translateX`, not a moving `right`: the rail's collapse
 * animates it over 200ms, and a transform travels on the compositor where
 * `right` re-lays-out the column every frame.
 *
 * `right-3`/`sm:right-6` leaves room for the banner's dismiss control, which
 * floats past its own right edge. The bottom inset adds the safe area, so a
 * phone's home indicator never sits on the banner.
 */
export function NotificationDock({
  alerts,
  totalAlertCount,
  mentions,
  ingestionActive,
}: {
  alerts: Alert[];
  totalAlertCount: number;
  mentions?: ChannelMention[];
  /** Was knowledge already being built when this page rendered? */
  ingestionActive?: boolean;
}) {
  return (
    <div
      style={{ transition: `var(${RIGHT_RAIL_TRANSITION_VAR})` }}
      data-slot="notification-dock"
      className="pointer-events-none fixed right-3 bottom-[calc(0.75rem_+_env(safe-area-inset-bottom))] z-40 flex w-[22rem] max-w-[calc(100vw-1.5rem)] flex-col items-end gap-3 sm:right-6 sm:bottom-[calc(1rem_+_env(safe-area-inset-bottom))] sm:max-w-[calc(100vw-3rem)] md:[transform:translateX(calc(var(--right-rail-width)*-1))] md:max-w-[calc(100vw_-_var(--right-rail-width)_-_3rem)]"
    >
      <NotificationCenter
        alerts={alerts}
        totalAlertCount={totalAlertCount}
        mentions={mentions}
      />
      <IngestionActivityCard initialActive={ingestionActive} />
    </div>
  );
}
