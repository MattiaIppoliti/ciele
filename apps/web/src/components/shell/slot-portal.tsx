"use client";

import { useCallback, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

/** The top bar's page controls (search, filters, export), on the breadcrumb's row. */
export const TOP_BAR_SLOT = "top-bar";
/** The Insights date-range chip, on the tab rail's row. */
export const INSIGHTS_RANGE_SLOT = "insights-range";
/** A page-owned viewer can dock beside the workspace, on the shell frame. */
export const RIGHT_RAIL_SLOT = "shell-right-rail";

type SlotId = typeof TOP_BAR_SLOT | typeof INSIGHTS_RANGE_SLOT | typeof RIGHT_RAIL_SLOT;

const slots = new Map<SlotId, HTMLElement>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/**
 * A mount point for `SlotPortal`. It registers from its ref, so only once
 * React has committed it: the top bar sits in its own Suspense boundary, and a
 * lookup by DOM id could find its server HTML before it hydrates (and write
 * into it) or miss it when a page mounts first and never look again.
 */
export function PortalSlot({ id, className }: { id: SlotId; className?: string }) {
  const ref = useCallback(
    (el: HTMLDivElement) => {
      slots.set(id, el);
      notify();
      return () => {
        // A second mount of the same slot may have replaced this one already.
        if (slots.get(id) === el) slots.delete(id);
        notify();
      };
    },
    [id]
  );
  return <div ref={ref} className={className} />;
}

/**
 * Renders a page's controls into a `PortalSlot` a layout owns, so the layout
 * keeps its row and the page keeps its state. The children stay owned by the
 * caller, so their state and refs behave as if rendered in place; only the DOM
 * position moves. Renders nothing until the slot has mounted.
 */
export function SlotPortal({ id, children }: { id: SlotId; children: React.ReactNode }) {
  const slot = useSyncExternalStore(
    subscribe,
    () => slots.get(id) ?? null,
    () => null
  );
  return slot ? createPortal(children, slot) : null;
}
