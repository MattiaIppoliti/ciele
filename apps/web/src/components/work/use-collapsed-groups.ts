"use client";

import { useTableOrder } from "@/components/ui/table-preferences";

/**
 * Which groups (List) or columns (Board) a Member folded, remembered per
 * Member in this browser (#1050). Each entry records a choice, `key=1` folded
 * and `key=0` open, so a group a view folds by default (My Tasks' Completed)
 * stays open once someone opened it.
 */
export function useCollapsedGroups(storeKey: string, foldedByDefault: (group: string) => boolean = () => false) {
  const [entries, save] = useTableOrder(storeKey);
  const choice = (group: string) => entries.find((entry) => entry.slice(0, entry.lastIndexOf("=")) === group);
  const isCollapsed = (group: string) => {
    const made = choice(group);
    return made ? made.endsWith("=1") : foldedByDefault(group);
  };
  const setCollapsed = (group: string, collapsed: boolean) =>
    save([...entries.filter((entry) => entry !== choice(group)), `${group}=${collapsed ? 1 : 0}`]);
  return { isCollapsed, setCollapsed };
}
