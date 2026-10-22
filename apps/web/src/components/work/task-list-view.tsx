"use client";

import { useState, type ReactNode } from "react";
import { Crosshair } from "lucide-react";
import type { ProjectMilestone, Task, TaskDependency, TaskLabelLink, WorkFilterField, WorkLayout, WorkViewQuery } from "@agent-hub/core";
import { WORK_GROUP_FIELDS, WORK_SORT_FIELDS } from "@agent-hub/core";
import { TaskBoard } from "./task-board";
import { TaskCalendar } from "./task-calendar";
import { TaskDrawer } from "./task-drawer";
import { TaskList } from "./task-list";
import { TableColumnsControl, TaskTable } from "./task-table";
import { TaskTimeline, TimelineZoomSwitch } from "./task-timeline";
import { useWorkView } from "./use-work-view";
import { BAR_BUTTON, WorkToolbar } from "./work-toolbar";
import { PillButton } from "./work-ui";

/** A task view's layout: the three a Saved View can keep, plus the two drawn by date (#1065). */
export type TaskViewLayout = WorkLayout | "calendar" | "timeline";

/**
 * A task view with its toolbar and its drawer (#1050, #1064): one component
 * for every scope and layout. The scope decides which filters make sense and
 * where a new Task goes; the layout decides how the same query is drawn.
 */

const ALL_FIELDS: WorkFilterField[] = ["status", "assignee", "priority", "label", "project", "due", "created", "updated", "starred"];

export function TaskListView({
  scope,
  layout = "list",
  tasks,
  labelLinks,
  dependencies = [],
  milestones = [],
  defaults,
  initialQuery,
  initialTaskId,
  projectId,
  projectMemberIds,
  header,
  toolbarExtra,
  newTask,
  onQueryChange,
}: {
  scope: "project" | "my-tasks" | "all-tasks";
  layout?: TaskViewLayout;
  tasks: Task[];
  labelLinks: TaskLabelLink[];
  dependencies?: TaskDependency[];
  /** The Timeline's milestone lane. */
  milestones?: ProjectMilestone[];
  defaults: WorkViewQuery;
  initialQuery: WorkViewQuery;
  initialTaskId: string | null;
  projectId?: string;
  projectMemberIds?: string[] | null;
  /** Above the toolbar (My Tasks' summary line). */
  header?: ReactNode;
  /** After the toolbar's own controls (the layout switch, Save view). */
  /** After the layout controls; gets the query and the way to change it (My Tasks' Starred chip). */
  toolbarExtra?: (query: WorkViewQuery, change: (next: WorkViewQuery) => void) => ReactNode;
  /** The toolbar's right end: the view's New task. */
  newTask?: ReactNode;
  onQueryChange?: (query: WorkViewQuery) => void;
}) {
  const { query, setQuery, openTaskId, openTask } = useWorkView(initialQuery, defaults, initialTaskId);
  const change = (next: WorkViewQuery) => {
    setQuery(next);
    onQueryChange?.(next);
  };
  const fields = ALL_FIELDS.filter(
    (field) => !(scope === "project" && field === "project") && !(scope === "my-tasks" && field === "assignee")
  );
  const groups = WORK_GROUP_FIELDS.filter((g) => !(scope === "project" && g === "project"));
  const sorts = WORK_SORT_FIELDS.filter((s) => !(scope === "my-tasks" && s === "manual"));
  const boardScope = scope === "my-tasks" ? "all-tasks" : scope;
  // Today is an event, not a place: it scrolls the Timeline and stays out of the URL.
  const [todayTick, setTodayTick] = useState(0);
  const byDate = layout === "calendar" || layout === "timeline";

  return (
    <TaskDrawer openTaskId={openTaskId} onOpenTask={openTask} projectTasks={tasks}>
      {/* A size container: with the drawer open the view is narrower than
          `main`, and its columns have to answer to the view's own width.
          Edge to edge, each layout keeps its own gutter. */}
      <div className="@container flex h-full min-h-0 flex-col">
        {header}
        <WorkToolbar
          query={query}
          onChange={change}
          fields={fields}
          sorts={sorts}
          groups={groups}
          showGroup={scope !== "my-tasks" && layout !== "board" && layout !== "calendar"}
          showSort={!byDate}
          extra={
            <>
              {layout === "table" && <TableColumnsControl scope={boardScope} />}
              {layout === "timeline" && (
                <>
                  <TimelineZoomSwitch className="ml-1" />
                  <PillButton className={BAR_BUTTON} onClick={() => setTodayTick((n) => n + 1)}>
                    <Crosshair className="size-3.5" /> Today
                  </PillButton>
                </>
              )}
              {toolbarExtra?.(query, change)}
            </>
          }
          right={newTask}
        />
        <div className={layout === "list" ? "min-h-0 flex-1 overflow-y-auto pb-6" : "min-h-0 flex-1 overflow-hidden"}>
          {layout === "calendar" ? (
            <TaskCalendar
              tasks={tasks}
              labelLinks={labelLinks}
              query={query}
              scope={scope}
              projectId={projectId}
              onOpenTask={openTask}
            />
          ) : layout === "timeline" ? (
            <TaskTimeline
              tasks={tasks}
              labelLinks={labelLinks}
              dependencies={dependencies}
              milestones={milestones}
              query={query}
              scope={scope}
              todayTick={todayTick}
              onOpenTask={openTask}
              openTaskId={openTaskId}
            />
          ) : layout === "board" ? (
            <TaskBoard
              tasks={tasks}
              labelLinks={labelLinks}
              query={query}
              scope={boardScope}
              projectId={projectId}
              onOpenTask={openTask}
              openTaskId={openTaskId}
            />
          ) : layout === "table" ? (
            <TaskTable
              tasks={tasks}
              labelLinks={labelLinks}
              dependencies={dependencies}
              query={query}
              onQueryChange={change}
              scope={boardScope}
              projectId={projectId}
              onOpenTask={openTask}
              openTaskId={openTaskId}
            />
          ) : (
            <TaskList
              tasks={tasks}
              labelLinks={labelLinks}
              query={query}
              scope={scope}
              projectId={projectId}
              projectMemberIds={projectMemberIds}
              onOpenTask={openTask}
              openTaskId={openTaskId}
              onSortManual={() => change({ ...query, sort: { field: "manual", direction: "asc" } })}
            />
          )}
        </div>
      </div>
    </TaskDrawer>
  );
}
