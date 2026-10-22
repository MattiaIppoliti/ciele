"use client";

import { useMemo } from "react";
import type { WorkViewContext } from "@agent-hub/core";
import { useWorkDirectory } from "./work-directory";

/**
 * What every task view hands the view engine's predicate and comparator: one
 * builder instead of a copy per layout, so a field the engine learns (the
 * starred chip) reaches List, Board, Table, Calendar and Timeline at once.
 */
export function useWorkViewContext(labelsOf: (taskId: string) => readonly string[]): WorkViewContext {
  const dir = useWorkDirectory();
  return useMemo(
    () => ({
      today: dir.today,
      now: `${dir.today}T12:00:00.000Z`,
      labelsOf,
      keyOf: dir.keyOf,
      assigneeName: (id) => dir.person(id)?.name ?? id,
      projectName: (id) => dir.project(id)?.name ?? id,
      isStarred: (taskId) => dir.isFavorite({ taskId }),
    }),
    [dir, labelsOf]
  );
}
