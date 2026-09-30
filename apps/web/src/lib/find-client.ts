import { useSyncExternalStore } from "react";
import { loadFindDetails, loadFindRecords } from "@/app/find-actions";
import { createFindStore, type FindSnapshot } from "@/lib/find-store";

/**
 * The one Find store of the browser tab, shared by the palette and by the
 * buttons that open it (which `prefetchFind` on a resting pointer so the list
 * is already there when they are pressed).
 *
 * The server holds a copy too, and it stays empty: creating a store reads
 * nothing, and only effects and event handlers, which never run on the server,
 * ask it to load. That matters, because what it held would be one Member's
 * list, kept in a process that serves every Member.
 */
export const findStore = createFindStore({ loadRecords: loadFindRecords, loadDetails: loadFindDetails });

/** What the server rendered, and what hydration must match: the empty store. */
const initialSnapshot = findStore.getSnapshot();

export function useFindSnapshot(): FindSnapshot {
  return useSyncExternalStore(findStore.subscribe, findStore.getSnapshot, () => initialSnapshot);
}

/** For a control that opens the palette: warm the list when the pointer rests on it. */
export const prefetchFind = findStore.prefetch;
