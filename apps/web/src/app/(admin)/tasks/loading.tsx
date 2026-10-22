"use client";

import { usePathname } from "next/navigation";
import { TaskListSkeleton, TaskPageSkeleton } from "@/components/work/work-skeletons";

/**
 * Besides `/tasks` itself, this boundary is what paints first on the way into
 * any route below it, so it draws the destination's shape, read from the URL
 * the router is heading to: the Calendar's grid, the Timeline's lanes, a
 * Task's page, or the list.
 */
export default function AllTasksLoading() {
  // /tasks/{calendar|timeline|taskId}
  const child = (usePathname() ?? "").split("/")[2];
  if (child === "calendar" || child === "timeline") return <TaskListSkeleton label={child} layout={child} />;
  if (child) return <TaskPageSkeleton />;
  return <TaskListSkeleton label="tasks" />;
}
