"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Alert } from "@agent-hub/core";
import { NotificationStack } from "@/components/motion/notification-stack";
import { RIGHT_RAIL_TRANSITION_VAR } from "@/components/shell/right-rail";
import {
  setNotificationListener,
  type NotificationInput,
} from "@/lib/notification-bus";
import {
  alertNotification,
  autoDismisses,
  visibleNotifications,
  AUTO_DISMISS_MS,
  type AppNotification,
} from "@/lib/notifications";

/** Cards the banner shows at once; the rest wait behind the count badge. */
const VISIBLE_LIMIT = 3;

/**
 * The admin shell's bottom-right notification banner. It merges two streams:
 *
 * - **Alerts** rendered on the server (operational health), they stay until an
 *   admin resolves them, and clicking through opens `/alerts`.
 * - **Events** raised by the UI through `@/lib/toast`, "Published v3",
 *   "Upload failed". Successes and notices clear themselves; errors and
 *   warnings wait for the close control.
 *
 * Alert cards step aside on `/alerts` itself (the page already lists them);
 * event cards keep showing there.
 */
export function NotificationCenter({
  alerts,
  totalAlertCount,
}: {
  alerts: Alert[];
  totalAlertCount: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [events, setEvents] = useState<AppNotification[]>([]);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const sequence = useRef(0);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const drop = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setEvents((current) => current.filter((event) => event.id !== id));
  }, []);

  const push = useCallback(
    (input: NotificationInput) => {
      const id = `event:${(sequence.current += 1)}`;
      const event: AppNotification = {
        ...input,
        id,
        createdAt: Date.now(),
        source: "event",
      };
      setEvents((current) => [...current, event]);
      if (autoDismisses(event)) {
        timers.current.set(
          id,
          setTimeout(() => drop(id), AUTO_DISMISS_MS),
        );
      }
    },
    [drop],
  );

  useEffect(() => {
    setNotificationListener(push);
    return () => setNotificationListener(null);
  }, [push]);

  // An event pushed right before unmount must not leave a setTimeout holding
  // this tree alive, so sweep every pending auto-dismiss on the way out.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const onAlertsPage = pathname.startsWith("/alerts");

  const items = useMemo(() => {
    const alertItems = onAlertsPage ? [] : alerts.map(alertNotification);
    return visibleNotifications([...alertItems, ...events], {
      limit: VISIBLE_LIMIT,
      dismissed,
    });
  }, [alerts, events, dismissed, onAlertsPage]);

  if (items.length === 0) return null;

  const shownAlerts = items.filter((item) => item.source === "alert").length;
  const hiddenAlerts = onAlertsPage ? 0 : totalAlertCount - shownAlerts;

  const closeAll = () => {
    for (const item of items) {
      if (item.source === "event") drop(item.id);
    }
    setDismissed((current) => {
      const next = new Set(current);
      for (const item of items) next.add(item.id);
      return next;
    });
  };

  return (
    // right-6 leaves room for the dismiss control, which floats past the
    // banner's own right edge.
    //
    // From `md` up the inset is measured from the workspace's right rail rather
    // than from the viewport: a docked live preview is user-resizable, and
    // floating over it hid the panel's composer. `--right-rail-width` is 0
    // wherever the rail is empty, and the offset starts at `md` because that is
    // the breakpoint at which the rail's panel enters the flow at all, below it
    // there is no rail to stand beside. Raising z-index instead would have
    // hidden the alerts, which is the wrong way round: an active alert has to
    // stay readable.
    <div
      style={{ transition: `var(${RIGHT_RAIL_TRANSITION_VAR})` }}
      className="pointer-events-none fixed right-3 bottom-3 z-40 flex w-[22rem] max-w-[calc(100vw-1.5rem)] justify-end sm:right-6 sm:bottom-4 sm:max-w-[calc(100vw-3rem)] md:right-[calc(var(--right-rail-width)_+_1.5rem)] md:max-w-[calc(100vw_-_var(--right-rail-width)_-_3rem)]"
    >
      <NotificationStack
        items={items.map((item) => ({
          id: item.id,
          status: item.status,
          title: item.title,
          description: item.description,
          trailing: item.tag,
        }))}
        maxVisible={items.length}
        collapsedLabel={collapsedLabel(
          shownAlerts + hiddenAlerts,
          items.length,
        )}
        expandedLabel={
          shownAlerts > 0
            ? hiddenAlerts > 0
              ? `View all ${totalAlertCount}`
              : "View all"
            : "Dismiss"
        }
        onViewAll={shownAlerts > 0 ? () => router.push("/alerts") : closeAll}
        onClose={closeAll}
        className="pointer-events-auto shadow-lg"
        classNames={{
          trailing: "text-muted-foreground",
          description: "line-clamp-2",
        }}
      />
    </div>
  );
}

/** The count badge next to this label already carries the number. */
function collapsedLabel(alertCount: number, itemCount: number): string {
  if (alertCount === 1) return "alert needs attention";
  if (alertCount > 1) return "alerts need attention";
  return itemCount === 1 ? "notification" : "notifications";
}
