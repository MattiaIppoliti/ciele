"use client";

import { useCallback, useEffect, type ReactNode } from "react";
import type { ConfirmDeleteRequest } from "@/components/ui/confirm-delete-modal";

/**
 * The guard a form with unsaved edits puts on every way out.
 *
 * Two halves, because the browser and the app offer different hooks. A reload
 * or a closed tab gets the browser's own "Leave site?" prompt, which is all a
 * page may show there. Cancel, Escape, a backdrop click or a breadcrumb gets
 * the in-app "Discard your changes?" confirm through `leave(go)`. The App
 * Router exposes no navigation-blocking hook, so a link the form does not
 * route through `leave` is not covered.
 */
export function useUnsavedChanges(options: {
  /** True while anything differs from what was loaded. */
  dirty: boolean;
  /**
   * The form's `confirmDelete` (`useConfirmDelete`), for the in-app confirm.
   * Without it `leave` goes straight away and only the browser prompt guards.
   */
  confirmDelete?: (request: ConfirmDeleteRequest) => void;
  /** What the confirm says is unsaved: "The edits to this channel are not saved yet." */
  description?: ReactNode;
  /**
   * While a save is in flight, leaving does not ask: the edits are on their
   * way. A surface that must not close mid-save at all, because closing would
   * hide whether the save landed, checks its pending flag before `leave`
   * instead.
   */
  saving?: boolean;
}): { leave: (go: () => void) => void } {
  const { dirty, confirmDelete, description, saving = false } = options;

  useEffect(() => {
    if (!dirty) return;
    return warnBeforeUnload(window);
  }, [dirty]);

  const leave = useCallback(
    (go: () => void) => {
      if (!dirty || saving || !confirmDelete) {
        go();
        return;
      }
      confirmDelete(discardChangesRequest(description, go));
    },
    [dirty, saving, confirmDelete, description],
  );

  return { leave };
}

/**
 * Ask the browser to prompt before the page unloads, until the returned
 * function is called. `preventDefault` is the whole modern contract; a custom
 * message has not been shown by any browser for years.
 */
export function warnBeforeUnload(target: Pick<EventTarget, "addEventListener" | "removeEventListener">): () => void {
  const warn = (event: Event) => event.preventDefault();
  target.addEventListener("beforeunload", warn);
  return () => target.removeEventListener("beforeunload", warn);
}

/** The one wording every form's discard confirm uses. */
export function discardChangesRequest(
  description: ReactNode,
  go: () => void,
): ConfirmDeleteRequest {
  return {
    title: "Discard your changes?",
    description: description ?? "Your edits are not saved yet.",
    confirmLabel: "Discard changes",
    onConfirm: go,
  };
}
