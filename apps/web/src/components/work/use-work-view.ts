"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { WorkViewQuery } from "@agent-hub/core";
import { workQueryToParams } from "@agent-hub/core";
import { replaceFilterParams } from "@/lib/url-state";
import { DATE_VIEW_DEFAULTS, dateViewFromSearchParams, type DateViewUrlState } from "@/lib/work/work-calendar";

/**
 * A work view's shareable state (#1050): the query and the open Task live in
 * the URL through `replaceFilterParams`, so a copied link reproduces the view
 * and a reload keeps it, without a navigation or a server round trip (the page
 * already holds the rows).
 */
export function useWorkView(initial: WorkViewQuery, defaults: WorkViewQuery, initialTaskId: string | null) {
  const [query, setQueryState] = useState(initial);
  const { openTaskId, openTask } = useOpenTask(initialTaskId);

  const setQuery = useCallback(
    (next: WorkViewQuery | ((current: WorkViewQuery) => WorkViewQuery)) => {
      setQueryState((current) => {
        const value = typeof next === "function" ? next(current) : next;
        replaceFilterParams(workQueryToParams(value, defaults), workQueryToParams(defaults, defaults));
        return value;
      });
    },
    [defaults]
  );

  return { query, setQuery, openTaskId, openTask };
}

/** The Task open in the drawer, kept in `?task=`. */
export function useOpenTask(initialTaskId: string | null) {
  const [openTaskId, setOpenTaskId] = useState<string | null>(initialTaskId);

  const openTask = useCallback((id: string | null) => {
    setOpenTaskId(id);
    replaceFilterParams({ task: id ?? "" }, { task: "" });
  }, []);

  // Back and forward restore what the URL says.
  useEffect(() => {
    const onPop = () => setOpenTaskId(new URLSearchParams(window.location.search).get("task"));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  return { openTaskId, openTask };
}

/**
 * Where the Calendar and the Timeline are looking (#1065): the period, the
 * day and the zoom. The URL is the only copy, read through `useSearchParams`
 * (which Next keeps in step with `replaceFilterParams`), so the server renders
 * a shared link on its period, and back or forward lands on the one its entry
 * recorded.
 */
export function useDateView(): [DateViewUrlState, (patch: Partial<DateViewUrlState>) => void] {
  const place = dateViewFromSearchParams(useSearchParams());
  const setPlace = useCallback((patch: Partial<DateViewUrlState>) => {
    const current = dateViewFromSearchParams(new URLSearchParams(window.location.search));
    replaceFilterParams({ ...current, ...patch }, DATE_VIEW_DEFAULTS);
  }, []);
  return [place, setPlace];
}
