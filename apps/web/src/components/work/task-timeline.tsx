"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { Hint } from "@agent-hub/ui";
import type { ProjectMilestone, Task, TaskLabelLink, WorkGroupField, WorkViewQuery } from "@agent-hub/core";
import { addDays, groupTasks, matchesWorkQuery, taskProgress } from "@agent-hub/core";
import { cn } from "@/lib/utils";
import { TASK_STATUS_TONE, groupTitle, type Tone } from "@/lib/work/work-format";
import {
  barEditPatch,
  barGeometry,
  dayX,
  dependencyPath,
  isWeekend,
  snapDays,
  timelineMonths,
  timelineRange,
  type BarEdit,
  type TimelineRange,
  type TimelineZoom,
} from "@/lib/work/work-calendar";
import { TaskStatusIcon } from "./work-icons";
import { useTaskMutations } from "./use-task-mutations";
import { useDateView } from "./use-work-view";
import { useWorkDirectory } from "./work-directory";
import { useWorkViewContext } from "./use-work-view-context";
import { Segmented } from "./work-ui";

/**
 * The Timeline (#1065): every dated Task as a bar from its start to its due
 * date, grouped down the left, with weekends shaded, a line at today, a lane of
 * milestones and an arrow from each blocker to what it blocks. A bar drags to
 * move and its ends drag to resize, snapping to days; the drawer's date pickers
 * are the keyboard path. Undated Tasks are counted, never drawn. Measured in
 * pixels, not rems, because the bars are placed by arithmetic on them: a 300px
 * task column, a 52px two-row header, 36px rows and 24px bars, at 32px a day by
 * week or 11px a day by month.
 */

const ROW = 36;
const BAR = 24;
const HEAD = 52;
const LEFT = 300;

const BAR_TONE: Record<Tone, { bar: string; fill: string }> = {
  gray: { bar: "bg-tone-gray border-tone-gray-ink/45 hover:border-tone-gray-ink", fill: "bg-tone-gray-ink/25" },
  blue: { bar: "bg-tone-blue border-tone-blue-ink/45 hover:border-tone-blue-ink", fill: "bg-tone-blue-ink/25" },
  green: { bar: "bg-tone-green border-tone-green-ink/45 hover:border-tone-green-ink", fill: "bg-tone-green-ink/25" },
  amber: { bar: "bg-tone-amber border-tone-amber-ink/45 hover:border-tone-amber-ink", fill: "bg-tone-amber-ink/25" },
  red: { bar: "bg-tone-red border-tone-red-ink/45 hover:border-tone-red-ink", fill: "bg-tone-red-ink/25" },
  purple: { bar: "bg-tone-purple border-tone-purple-ink/45 hover:border-tone-purple-ink", fill: "bg-tone-purple-ink/25" },
};

type Row =
  | { kind: "milestones" }
  | { kind: "group"; key: string; title: string; count: number }
  | { kind: "task"; task: Task };

export function TaskTimeline({
  tasks,
  labelLinks,
  dependencies,
  milestones,
  query,
  scope,
  todayTick,
  onOpenTask,
  openTaskId,
}: {
  tasks: Task[];
  labelLinks: TaskLabelLink[];
  dependencies: { taskId: string; blockedById: string }[];
  milestones: ProjectMilestone[];
  query: WorkViewQuery;
  scope: "project" | "my-tasks" | "all-tasks";
  /** Bumped by the toolbar's Today: scroll back to today. */
  todayTick: number;
  onOpenTask: (id: string) => void;
  openTaskId: string | null;
}) {
  const dir = useWorkDirectory();
  const mutations = useTaskMutations(tasks);
  const scroller = useRef<HTMLDivElement>(null);
  const [{ zoom }] = useDateView();
  const range = useMemo(() => timelineRange(dir.today, zoom), [dir.today, zoom]);
  const width = range.days * range.dayWidth;

  const labelsOf = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const link of labelLinks) map.set(link.taskId, [...(map.get(link.taskId) ?? []), link.labelId]);
    return (id: string) => map.get(id) ?? [];
  }, [labelLinks]);
  const ctx = useWorkViewContext(labelsOf);
  const subtasksOf = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of mutations.tasks) if (task.parentId) map.set(task.parentId, [...(map.get(task.parentId) ?? []), task]);
    return map;
  }, [mutations.tasks]);
  const visible = useMemo(
    () => mutations.tasks.filter((t) => (scope === "my-tasks" || !t.parentId) && matchesWorkQuery(t, query, ctx)),
    [mutations.tasks, scope, query, ctx]
  );
  const dated = visible.filter((t) => t.dueDate);
  const unscheduled = visible.length - dated.length;
  const group: WorkGroupField = query.group;

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = milestones.length ? [{ kind: "milestones" }] : [];
    const start = (t: Task) => t.startDate && t.dueDate && t.startDate <= t.dueDate ? t.startDate : (t.dueDate ?? "");
    for (const g of groupTasks(dated, group, ctx)) {
      if (!g.tasks.length) continue;
      if (group !== "none") {
        out.push({
          kind: "group",
          key: g.key,
          count: g.tasks.length,
          title: groupTitle(group, g.key, {
            person: (id) => dir.person(id)?.name ?? "Someone",
            project: (id) => dir.project(id)?.name ?? "Project",
          }),
        });
      }
      for (const task of [...g.tasks].sort((a, b) => start(a).localeCompare(start(b)))) out.push({ kind: "task", task });
    }
    return out;
  }, [milestones.length, dated, group, ctx, dir]);
  const height = rows.length * ROW;
  const rowOf = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((row, i) => row.kind === "task" && map.set(row.task.id, i));
    return map;
  }, [rows]);

  // Open on today, and come back to it on the toolbar's Today.
  useEffect(() => {
    const node = scroller.current;
    if (node) node.scrollLeft = Math.max(0, dayX(range, dir.today) - 160);
  }, [range, dir.today, todayTick]);

  const tone = (task: Task): Tone => {
    if (group === "status" || group === "none") {
      const project = dir.project(task.projectId);
      return project ? project.color : "gray";
    }
    return TASK_STATUS_TONE[task.status];
  };

  const arrows = dependencies.flatMap((edge) => {
    const from = rowOf.get(edge.blockedById);
    const to = rowOf.get(edge.taskId);
    if (from === undefined || to === undefined) return [];
    const blocker = (rows[from] as { task: Task }).task;
    const blocked = (rows[to] as { task: Task }).task;
    const a = barGeometry(range, blocker);
    const b = barGeometry(range, blocked);
    if (!a || !b) return [];
    const start = { x: a.x + a.width, y: from * ROW + ROW / 2 };
    const end = { x: b.x, y: to * ROW + ROW / 2 };
    return [{ id: `${edge.blockedById}-${edge.taskId}`, d: dependencyPath(start, end), late: end.x < start.x }];
  });

  if (!visible.length) {
    return <p className="text-muted-foreground px-6 py-10 text-center text-sm">No tasks match this view.</p>;
  }

  return (
    <div ref={scroller} className="relative h-full min-h-0 overflow-auto" aria-label="Timeline">
      <div className="relative" style={{ width: LEFT + width, height: HEAD + height }}>
        {/* Header: the task column's label, then the months over the days. */}
        <div className="bg-content sticky top-0 z-[6] flex" style={{ height: HEAD }}>
          <div
            className="bg-content border-alpha-medium text-muted-foreground sticky left-0 z-[7] flex shrink-0 items-end justify-between border-r border-b pr-3 pb-2 pl-6 text-xs font-medium"
            style={{ width: LEFT }}
          >
            <span>Task</span>
            {unscheduled > 0 && (
              <Hint label="Tasks without a due date are not drawn">
                <span>{unscheduled} unscheduled</span>
              </Hint>
            )}
          </div>
          <TimelineHeader range={range} zoom={zoom} today={dir.today} />
        </div>
        <div className="flex">
          {/* The task column, pinned while the chart scrolls sideways. */}
          <div className="bg-content border-alpha-medium sticky left-0 z-[5] shrink-0 border-r" style={{ width: LEFT }}>
            {rows.map((row) =>
              row.kind === "milestones" ? (
                <div key="milestones" className="border-alpha-medium text-muted-foreground flex items-center border-b pl-6 text-xs font-semibold" style={{ height: ROW }}>
                  Milestones
                </div>
              ) : row.kind === "group" ? (
                <div
                  key={`g-${row.key}`}
                  className="bg-alpha-lighter border-alpha-medium text-muted-foreground flex items-center gap-1.5 border-b pr-3 pl-6 text-xs font-semibold"
                  style={{ height: ROW }}
                >
                  {group === "status" && <TaskStatusIcon status={row.key as Task["status"]} className="size-3.5" />}
                  <span className="truncate">{row.title}</span>
                  <span className="font-medium opacity-70">{row.count}</span>
                </div>
              ) : (
                <button
                  key={row.task.id}
                  type="button"
                  onClick={() => onOpenTask(row.task.id)}
                  data-open={openTaskId === row.task.id || undefined}
                  className="press border-alpha-medium hover:bg-alpha-lighter data-[open]:bg-alpha-light flex w-full items-center gap-2 border-b pr-3 pl-6 text-left text-sm"
                  style={{ height: ROW }}
                >
                  <TaskStatusIcon status={row.task.status} className="size-3.5" />
                  <span className={cn("min-w-0 flex-1 truncate", row.task.status === "done" && "text-muted-foreground line-through decoration-1")}>
                    {row.task.title}
                  </span>
                  <span className="text-muted-foreground shrink-0 font-mono text-2xs">{dir.keyOf(row.task)}</span>
                </button>
              )
            )}
          </div>
          {/* The chart. */}
          <div className="relative shrink-0" style={{ width, height }}>
            {zoom === "weeks" &&
              Array.from({ length: range.days }, (_, i) => addDays(range.start, i))
                .filter(isWeekend)
                .map((day) => (
                  <div key={day} aria-hidden className="bg-alpha-lighter absolute inset-y-0" style={{ left: dayX(range, day), width: range.dayWidth }} />
                ))}
            {Array.from({ length: range.days / 7 }, (_, i) => (
              <div key={i} aria-hidden className="bg-alpha-medium absolute inset-y-0 w-px" style={{ left: i * 7 * range.dayWidth }} />
            ))}
            {rows.map((row, i) => (
              <div
                key={row.kind === "task" ? row.task.id : row.kind === "group" ? `g-${row.key}` : "milestones"}
                aria-hidden
                className={cn("border-alpha-medium absolute inset-x-0 border-b", row.kind === "group" && "bg-alpha-lighter")}
                style={{ top: i * ROW, height: ROW }}
              />
            ))}
            <div aria-hidden className="bg-primary/70 absolute inset-y-0 z-[2] w-0.5" style={{ left: dayX(range, dir.today) + range.dayWidth / 2 - 1 }} />
            {arrows.length > 0 && (
              <svg aria-hidden className="text-muted-foreground pointer-events-none absolute inset-0 z-[2]" width={width} height={height}>
                <defs>
                  <marker id="timeline-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                    <path d="M1 1 L7 4 L1 7" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                  </marker>
                </defs>
                {arrows.map((arrow) => (
                  <path
                    key={arrow.id}
                    d={arrow.d}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeDasharray={arrow.late ? "3 3" : undefined}
                    markerEnd="url(#timeline-arrow)"
                  />
                ))}
              </svg>
            )}
            {rows.map((row, i) =>
              row.kind === "milestones" ? (
                <MilestoneLane key="milestones" milestones={milestones} range={range} top={i * ROW} />
              ) : row.kind === "task" ? (
                <TimelineBar
                  key={row.task.id}
                  task={row.task}
                  range={range}
                  top={i * ROW + (ROW - BAR) / 2}
                  tone={tone(row.task)}
                  progress={taskProgress(row.task, subtasksOf.get(row.task.id) ?? [])}
                  editable={dir.canEdit}
                  onOpen={() => onOpenTask(row.task.id)}
                  onEdit={(patch) => mutations.update(row.task, patch)}
                />
              ) : null
            )}
          </div>
        </div>
      </div>
      {mutations.confirmDeleteModal}
    </div>
  );
}

/** Weeks or Months, kept in the URL (#1050) so a shared link opens at the same zoom. */
export function TimelineZoomSwitch({ className }: { className?: string }) {
  const [{ zoom }, setPlace] = useDateView();
  return (
    <Segmented
      label="Timeline zoom"
      className={className}
      value={zoom}
      onChange={(next) => setPlace({ zoom: next })}
      options={[
        { value: "weeks", label: "Weeks" },
        { value: "months", label: "Months" },
      ]}
    />
  );
}

function TimelineHeader({ range, zoom, today }: { range: TimelineRange; zoom: TimelineZoom; today: string }) {
  const months = timelineMonths(range);
  return (
    <div className="border-alpha-medium relative shrink-0 border-b" style={{ width: range.days * range.dayWidth }}>
      <div className="flex h-6.5">
        {months.map((month) => (
          <div key={month.month} className="border-alpha-strong shrink-0 border-l py-1.25 text-xs font-semibold" style={{ width: month.days * range.dayWidth }}>
            <span className="sticky left-[calc(300px+0.5rem)] px-2 whitespace-nowrap">{month.label}</span>
          </div>
        ))}
      </div>
      <div className="border-alpha-medium flex h-6.5 border-t">
        {zoom === "weeks"
          ? Array.from({ length: range.days }, (_, i) => {
              const day = addDays(range.start, i);
              return (
                <div
                  key={day}
                  aria-current={day === today ? "date" : undefined}
                  className={cn(
                    "border-alpha-medium grid shrink-0 place-items-center border-l text-2xs tabular-nums",
                    day === today ? "text-primary font-semibold" : "text-muted-foreground"
                  )}
                  style={{ width: range.dayWidth }}
                >
                  {Number(day.slice(8))}
                </div>
              );
            })
          : Array.from({ length: range.days / 7 }, (_, i) => {
              const day = addDays(range.start, i * 7);
              return (
                <div key={day} className="border-alpha-medium text-muted-foreground flex shrink-0 items-center border-l px-1.5 text-2xs whitespace-nowrap" style={{ width: 7 * range.dayWidth }}>
                  {Number(day.slice(8))}
                </div>
              );
            })}
      </div>
    </div>
  );
}

/** One bar: drag the body to move it, either end to resize it; a click opens the Task. */
function TimelineBar({
  task,
  range,
  top,
  tone,
  progress,
  editable,
  onOpen,
  onEdit,
}: {
  task: Task;
  range: TimelineRange;
  top: number;
  tone: Tone;
  progress: number;
  editable: boolean;
  onOpen: () => void;
  onEdit: (patch: Pick<Task, "startDate" | "dueDate">) => void;
}) {
  const origin = useRef<{ x: number; edit: BarEdit; moved: boolean } | null>(null);
  const [drag, setDrag] = useState<{ edit: BarEdit; days: number } | null>(null);
  const preview = drag ? (barEditPatch(task, drag.edit, drag.days) ?? task) : task;
  const geometry = barGeometry(range, preview);
  if (!geometry) return null;
  const inside = geometry.width > 110;
  const done = task.status === "done";

  // The part grabbed names its edit, so one handler serves the body and both ends.
  const begin = (event: PointerEvent<HTMLElement>) => {
    if (!editable || event.button !== 0) return;
    event.stopPropagation();
    const edit = (event.currentTarget.dataset.edit ?? "move") as BarEdit;
    event.currentTarget.setPointerCapture(event.pointerId);
    origin.current = { x: event.clientX, edit, moved: false };
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    const start = origin.current;
    if (!start) return;
    const dx = event.clientX - start.x;
    if (Math.abs(dx) > 3) start.moved = true;
    if (start.moved) setDrag({ edit: start.edit, days: snapDays(dx, range.dayWidth) });
  };
  const end = (event: PointerEvent<HTMLElement>) => {
    const start = origin.current;
    origin.current = null;
    setDrag(null);
    if (!start) return;
    if (!start.moved) {
      if (start.edit === "move") onOpen();
      return;
    }
    const patch = barEditPatch(task, start.edit, snapDays(event.clientX - start.x, range.dayWidth));
    if (patch) onEdit(patch);
  };

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        aria-label={`${task.title}, ${task.startDate ?? task.dueDate} to ${task.dueDate}`}
        onKeyDown={(event) => (event.key === "Enter" || event.key === " ") && (event.preventDefault(), onOpen())}
        data-edit="move"
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={() => {
          origin.current = null;
          setDrag(null);
        }}
        data-dragging={drag ? true : undefined}
        className={cn(
          "group/bar absolute z-[3] flex items-center gap-1.5 overflow-hidden rounded-md border px-2 text-xs select-none",
          BAR_TONE[tone].bar,
          editable ? "cursor-grab data-[dragging]:cursor-grabbing data-[dragging]:shadow-strong" : "cursor-pointer",
          done && "opacity-60"
        )}
        style={{ left: geometry.x, top, width: geometry.width, height: BAR }}
      >
        <span aria-hidden className={cn("absolute inset-y-0 left-0 -z-[1]", BAR_TONE[tone].fill)} style={{ width: `${progress}%` }} />
        {inside && <span className={cn("truncate font-medium", done && "line-through decoration-1")}>{task.title}</span>}
        {editable && (
          <>
            <span
              aria-hidden
              data-edit="start"
              onPointerDown={begin}
              onPointerMove={move}
              onPointerUp={end}
              className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize opacity-0 group-hover/bar:opacity-100 hover:bg-current/20"
            />
            <span
              aria-hidden
              data-edit="end"
              onPointerDown={begin}
              onPointerMove={move}
              onPointerUp={end}
              className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize opacity-0 group-hover/bar:opacity-100 hover:bg-current/20"
            />
          </>
        )}
      </div>
      {!inside && (
        <span
          aria-hidden
          className="text-muted-foreground pointer-events-none absolute z-[3] flex items-center truncate text-xs whitespace-nowrap"
          style={{ left: geometry.x + geometry.width + 6, top, height: BAR }}
        >
          {task.title}
        </span>
      )}
    </>
  );
}

/** One diamond per date (same-day milestones share it), each named beside it. */
function MilestoneLane({ milestones, range, top }: { milestones: ProjectMilestone[]; range: TimelineRange; top: number }) {
  const byDate = new Map<string, string[]>();
  for (const milestone of milestones) byDate.set(milestone.date, [...(byDate.get(milestone.date) ?? []), milestone.name]);
  return (
    <>
      {[...byDate].map(([date, names]) => {
        const x = dayX(range, date) + range.dayWidth / 2;
        if (x < 0 || x > range.days * range.dayWidth) return null;
        return (
          <div key={date} className="absolute z-[3] flex h-4.5 items-center" style={{ left: x - 6, top: top + (ROW - 18) / 2 }}>
            <Hint label={`${names.join(", ")} · ${date}`}>
              <span className="flex items-center gap-2">
                <span aria-hidden className="bg-foreground size-3 shrink-0 rotate-45 rounded-sm" />
                <span className="max-w-55 truncate text-xs font-medium">{names.join(", ")}</span>
              </span>
            </Hint>
          </div>
        );
      })}
    </>
  );
}
