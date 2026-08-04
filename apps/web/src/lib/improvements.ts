import type { ComponentType } from "react";
import { ChartNoAxesColumnIncreasing, MoreHorizontal } from "lucide-react";
import type { ImprovementPriority, ImprovementStatus } from "@agent-hub/core";

type IconType = ComponentType<{ className?: string }>;

/** Kanban lanes, in board order. */
export const IMPROVEMENT_STATUSES: Array<{
  value: ImprovementStatus;
  label: string;
}> = [
  { value: "to_do", label: "To do" },
  { value: "in_progress", label: "In Progress" },
  { value: "in_review", label: "In Review" },
  { value: "done", label: "Done" },
  { value: "archived", label: "Archived" },
];

export const IMPROVEMENT_PRIORITIES: Array<{
  value: ImprovementPriority;
  label: string;
  /** Tailwind classes for the priority chip. */
  chip: string;
  /** Bar-graph icon (dots for "none"), matching the reference picker. */
  icon: IconType;
  /** Icon tint. */
  iconColor: string;
}> = [
  {
    value: "high",
    label: "High",
    chip: "bg-red-100 text-red-700",
    icon: ChartNoAxesColumnIncreasing,
    iconColor: "text-red-600",
  },
  {
    value: "medium",
    label: "Medium",
    chip: "bg-amber-100 text-amber-700",
    icon: ChartNoAxesColumnIncreasing,
    iconColor: "text-amber-600",
  },
  {
    value: "low",
    label: "Low",
    chip: "bg-blue-100 text-blue-700",
    icon: ChartNoAxesColumnIncreasing,
    iconColor: "text-blue-600",
  },
  {
    value: "none",
    label: "None",
    chip: "bg-muted text-muted-foreground",
    icon: MoreHorizontal,
    iconColor: "text-muted-foreground",
  },
];

/**
 * True when a click on an improvement link should stay a navigation (new tab,
 * new window, download) instead of opening the drawer in place.
 */
export function keepsLinkNavigation(event: {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  button: number;
}): boolean {
  return (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  );
}

export function improvementKey(seq: number): string {
  return `IMP-${seq}`;
}

/**
 * Surface classes for the `IMP-n` key badge, tinted per status so the key alone
 * says where the item stands — no need to find which lane the row sits in. Only
 * "To do" stays neutral: it is the resting state, and tinting it would leave
 * nothing for the others to contrast against.
 */
export function improvementKeyClass(status: ImprovementStatus): string {
  switch (status) {
    case "in_progress":
      return "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-400";
    case "in_review":
      return "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400";
    case "done":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
    case "archived":
      return "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-400";
    default:
      return "bg-muted/50";
  }
}

export function statusLabel(status: ImprovementStatus): string {
  return IMPROVEMENT_STATUSES.find((s) => s.value === status)?.label ?? status;
}

export function priorityMeta(priority: ImprovementPriority) {
  return (
    IMPROVEMENT_PRIORITIES.find((p) => p.value === priority) ??
    IMPROVEMENT_PRIORITIES[3]
  );
}
