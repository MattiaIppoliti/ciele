import type { ComponentType } from "react"
import { ChartNoAxesColumnIncreasing, MoreHorizontal } from "lucide-react"
import type { ImprovementPriority, ImprovementStatus } from "@agent-hub/core"

type IconType = ComponentType<{ className?: string }>

/** Kanban lanes, in board order. */
export const IMPROVEMENT_STATUSES: Array<{
  value: ImprovementStatus
  label: string
}> = [
  { value: "to_do", label: "To do" },
  { value: "in_progress", label: "In Progress" },
  { value: "in_review", label: "In Review" },
  { value: "done", label: "Done" },
  { value: "archived", label: "Archived" },
]

export const IMPROVEMENT_PRIORITIES: Array<{
  value: ImprovementPriority
  label: string
  /** Tailwind classes for the priority chip. */
  chip: string
  /** Bar-graph icon (dots for "none"), matching the reference picker. */
  icon: IconType
  /** Icon tint. */
  iconColor: string
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
]

export function improvementKey(seq: number): string {
  return `IMP-${seq}`
}

export function statusLabel(status: ImprovementStatus): string {
  return IMPROVEMENT_STATUSES.find((s) => s.value === status)?.label ?? status
}

export function priorityMeta(priority: ImprovementPriority) {
  return (
    IMPROVEMENT_PRIORITIES.find((p) => p.value === priority) ??
    IMPROVEMENT_PRIORITIES[3]
  )
}
