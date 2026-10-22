"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Task } from "@agent-hub/core";
import { Skeleton } from "@agent-hub/ui";
import { WorkspacePanel } from "@/components/ui/workspace-panel";
import { getTaskAction } from "@/app/work-actions";
import { PanelControlButtons, TaskDetailView, type LoadedTask, type PanelControls } from "./task-detail";

/**
 * The task drawer (#1054): a docked `WorkspacePanel` beside whichever view is
 * open, loading the Task named by `?task=` through a server action so the
 * list underneath never re-renders to open it.
 */
export function TaskDrawer({
  openTaskId,
  onOpenTask,
  projectTasks,
  children,
}: {
  openTaskId: string | null;
  onOpenTask: (id: string | null) => void;
  /** The Tasks the view holds, for Blocked by in the drawer. */
  projectTasks: Task[];
  children: ReactNode;
}) {
  const router = useRouter();
  const [detail, setDetail] = useState<LoadedTask | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!openTaskId) return;
    let cancelled = false;
    void getTaskAction(openTaskId).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setDetail(result.value);
        setError(null);
      } else {
        setDetail(null);
        setError(result.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [openTaskId, version]);

  const shown = detail && detail.task.id === openTaskId ? detail : null;
  // Full page and close sit on the Task's actions row; the panel draws no header.
  const panelControls: PanelControls = {
    onOpenFullPage: () => router.push(`/tasks/${openTaskId}`),
    onClose: () => onOpenTask(null),
  };
  // Loading and error have no actions row, so the two buttons get one alone.
  const controlsRow = (
    <div className="flex justify-end gap-1 px-5 pt-3">
      <PanelControlButtons {...panelControls} />
    </div>
  );
  return (
    <WorkspacePanel
      open={Boolean(openTaskId)}
      onClose={() => onOpenTask(null)}
      label="Task"
      slot="task"
      flush
      header={false}
      widthKey="work.task-drawer.width"
      detail={
        shown ? (
          <TaskDetailView
            detail={shown}
            variant="drawer"
            projectTasks={projectTasks.filter((t) => t.projectId === shown.project.id)}
            onChanged={reload}
            onOpenTask={(id) => onOpenTask(id)}
            onClosed={() => onOpenTask(null)}
            panelControls={panelControls}
          />
        ) : error ? (
          <>
            {controlsRow}
            <p className="text-muted-foreground px-5 py-6 text-sm">{error}</p>
          </>
        ) : (
          <>
            {controlsRow}
            <div className="flex flex-col gap-4 px-5 py-2" role="status" aria-busy="true">
              <span className="sr-only">Loading task…</span>
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-8 w-3/4" />
              <Skeleton className="h-36 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          </>
        )
      }
    >
      {children}
    </WorkspacePanel>
  );
}

/**
 * The full page of one Task (`/tasks/{id}`): the same detail. Every write it
 * makes revalidates `/tasks`, so the action's answer carries the refreshed
 * page and there is nothing to reload by hand.
 */
export function TaskPage({ detail, projectTasks }: { detail: LoadedTask; projectTasks: Task[] }) {
  const router = useRouter();
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 @md:px-8">
      <TaskDetailView
        detail={detail}
        variant="page"
        projectTasks={projectTasks}
        onChanged={() => {}}
        onOpenTask={(id) => router.push(`/tasks/${id}`)}
        onClosed={() => router.push(`/projects/${detail.project.id}/list`)}
      />
    </div>
  );
}
