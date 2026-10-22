"use client";

import { useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button, Hint, Popover, PopoverContent, PopoverTrigger } from "@agent-hub/ui";
import type { Task, TaskLabelLink, WorkViewQuery } from "@agent-hub/core";
import { addDays, matchesWorkQuery } from "@agent-hub/core";
import { cn } from "@/lib/utils";
import {
  WEEKDAY_LABELS,
  monthGrid,
  monthLabel,
  monthOf,
  reschedulePatch,
  shiftMonth,
  weekGrid,
  weekLabel,
  weekdayIndex,
} from "@/lib/work/work-calendar";
import { useDraggableTask, useTaskDropTarget } from "@/lib/drag/drag-adapter";
import { NewTaskDialog } from "./new-task-dialog";
import { PriorityIcon, TaskStatusIcon } from "./work-icons";
import { useTaskMutations } from "./use-task-mutations";
import { useDateView } from "./use-work-view";
import { useWorkDirectory } from "./work-directory";
import { useWorkViewContext } from "./use-work-view-context";
import { Segmented, TONE_FILL, WorkAvatar } from "./work-ui";

/**
 * The Calendar (#1065): Tasks on their due dates, a month of whole weeks or one
 * week. A chip dragged to another day moves the Task there and keeps its
 * length; "+" on a day starts a Task due that day. The drawer's date picker is
 * the keyboard path for the same move. The period and the day it shows live in
 * the URL (#1050). Laid out as a sub-toolbar (Today, previous and next, the
 * period, Month / Week), a weekday header, then ruled day cells with up to
 * three chips and "+n more".
 */

const CHIPS_PER_DAY = 3;
/** Projects the legend names before it counts the rest. */
const LEGEND_NAMED = 5;

export function TaskCalendar({
  tasks,
  labelLinks,
  query,
  scope,
  projectId,
  onOpenTask,
}: {
  tasks: Task[];
  labelLinks: TaskLabelLink[];
  query: WorkViewQuery;
  scope: "project" | "my-tasks" | "all-tasks";
  projectId?: string;
  onOpenTask: (id: string) => void;
}) {
  const dir = useWorkDirectory();
  const mutations = useTaskMutations(tasks);
  const [place, setPlace] = useDateView();
  const mode = place.period;
  const cursor = place.date || dir.today;
  const [creatingOn, setCreatingOn] = useState<string | null>(null);

  const labelsOf = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const link of labelLinks) map.set(link.taskId, [...(map.get(link.taskId) ?? []), link.labelId]);
    return (id: string) => map.get(id) ?? [];
  }, [labelLinks]);
  const ctx = useWorkViewContext(labelsOf);
  const visible = useMemo(
    () => mutations.tasks.filter((t) => (scope === "my-tasks" || !t.parentId) && matchesWorkQuery(t, query, ctx)),
    [mutations.tasks, scope, query, ctx]
  );
  const byDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of visible) if (task.dueDate) map.set(task.dueDate, [...(map.get(task.dueDate) ?? []), task]);
    return map;
  }, [visible]);
  const undated = visible.filter((t) => !t.dueDate).length;
  const projects = useMemo(
    () => (scope === "project" ? [] : [...new Set(visible.map((t) => t.projectId))].map((id) => dir.project(id)).filter((p) => p !== null)),
    [scope, visible, dir]
  );

  const reschedule = (taskId: string, day: string) => {
    const task = mutations.tasks.find((t) => t.id === taskId);
    if (!task || task.dueDate === day || !dir.canEdit) return;
    mutations.update(task, reschedulePatch(task, day));
  };
  const step = (direction: -1 | 1) =>
    setPlace({ date: mode === "month" ? shiftMonth(cursor, direction) : addDays(cursor, 7 * direction) });
  const canCreate = dir.canEdit && (projectId !== undefined || dir.projects.length > 0);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-alpha-medium flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b px-6 py-2">
        <Button size="sm" variant="secondary" className="h-7" onClick={() => setPlace({ date: "" })}>
          Today
        </Button>
        <div className="flex">
          <Button size="icon-sm" variant="ghost" aria-label={mode === "month" ? "Previous month" : "Previous week"} onClick={() => step(-1)}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label={mode === "month" ? "Next month" : "Next week"} onClick={() => step(1)}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <h2 className="mx-1 text-base font-semibold tracking-tight" aria-live="polite">
          {mode === "month" ? monthLabel(monthOf(cursor)) : weekLabel(cursor)}
        </h2>
        {undated > 0 && <span className="text-muted-foreground text-xs">{undated} without a due date</span>}
        <span className="flex-1" />
        {/* The Project legend (#1050): which colour is which Project, the first
            five by name and the rest counted, never silently dropped. */}
        {projects.length > 1 && (
          <ul aria-label="Project legend" className="text-muted-foreground mr-2 hidden items-center gap-2.5 text-xs @2xl:flex">
            {projects.slice(0, LEGEND_NAMED).map((project) => (
              <li key={project.id} className="inline-flex items-center gap-1">
                <i aria-hidden className={cn("size-2 rounded-sm", TONE_FILL[project.color])} />
                {project.name}
              </li>
            ))}
            {projects.length > LEGEND_NAMED && (
              <li title={projects.slice(LEGEND_NAMED).map((project) => project.name).join(", ")}>
                +{projects.length - LEGEND_NAMED} more
              </li>
            )}
          </ul>
        )}
        <Segmented
          label="Calendar range"
          value={mode}
          onChange={(period) => setPlace({ period })}
          options={[
            { value: "month", label: "Month" },
            { value: "week", label: "Week" },
          ]}
        />
      </div>
      {mode === "month" ? (
        <MonthView
          month={monthOf(cursor)}
          byDay={byDay}
          today={dir.today}
          canCreate={canCreate}
          onCreate={setCreatingOn}
          onOpenTask={onOpenTask}
          onReschedule={reschedule}
        />
      ) : (
        <WeekView
          day={cursor}
          byDay={byDay}
          today={dir.today}
          canCreate={canCreate}
          onCreate={setCreatingOn}
          onOpenTask={onOpenTask}
          onReschedule={reschedule}
        />
      )}
      {creatingOn && (
        <NewTaskDialog
          open
          onClose={() => setCreatingOn(null)}
          projectId={projectId}
          defaults={{ dueDate: creatingOn, ...(scope === "my-tasks" ? { assigneeMemberId: dir.viewerId } : {}) }}
        />
      )}
    </div>
  );
}

interface DayProps {
  byDay: Map<string, Task[]>;
  today: string;
  canCreate: boolean;
  onCreate: (day: string) => void;
  onOpenTask: (id: string) => void;
  onReschedule: (taskId: string, day: string) => void;
}

function MonthView({ month, ...props }: DayProps & { month: string }) {
  const cells = monthGrid(month);
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <div className="border-alpha-medium grid shrink-0 grid-cols-7 border-b" aria-hidden>
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="text-muted-foreground px-2.5 py-2 text-xs font-medium">
            {label}
          </div>
        ))}
      </div>
      <div
        role="grid"
        aria-label={monthLabel(month)}
        className="grid flex-1 grid-cols-7"
        style={{ gridTemplateRows: `repeat(${cells.length / 7}, minmax(112px, 1fr))` }}
      >
        {cells.map((day) => (
          <MonthDay key={day} day={day} outside={monthOf(day) !== month} {...props} />
        ))}
      </div>
    </div>
  );
}

function MonthDay({
  day,
  outside,
  byDay,
  today,
  canCreate,
  onCreate,
  onOpenTask,
  onReschedule,
}: DayProps & { day: string; outside: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const target = useTaskDropTarget(ref, { data: { kind: "day", day }, disabled: !canCreate, onDrop: (id) => onReschedule(id, day) });
  const items = byDay.get(day) ?? [];
  const isToday = day === today;
  const date = Number(day.slice(8));
  return (
    <div
      ref={ref}
      role="gridcell"
      aria-label={day}
      data-over={target.over || undefined}
      className={cn(
        "group/day border-alpha-medium relative flex min-w-0 flex-col gap-0.75 border-r border-b p-1.5 data-[over]:bg-tone-blue",
        weekdayIndex(day) === 6 && "border-r-0",
        outside && "bg-alpha-lighter"
      )}
    >
      <span
        aria-current={isToday ? "date" : undefined}
        className={cn(
          "grid size-5.5 place-items-center rounded-full text-xs font-medium",
          isToday ? "bg-primary text-primary-foreground" : outside ? "text-muted-foreground" : "text-foreground/80"
        )}
      >
        {date}
      </span>
      {canCreate && (
        <button
          type="button"
          aria-label={`Add task on ${day}`}
          onClick={() => onCreate(day)}
          className="press-control text-muted-foreground hover:bg-alpha-light hover:text-foreground absolute top-1.25 right-1.25 grid size-5.5 place-items-center rounded-md opacity-0 group-hover/day:opacity-100 [@media(hover:none)]:opacity-100 focus-visible:opacity-100"
        >
          <Plus className="size-3.5" />
        </button>
      )}
      {items.slice(0, CHIPS_PER_DAY).map((task) => (
        <CalendarChip key={task.id} task={task} onOpen={() => onOpenTask(task.id)} />
      ))}
      {items.length > CHIPS_PER_DAY && (
        <Popover>
          <PopoverTrigger
            render={<button type="button" className="press-text text-muted-foreground hover:text-foreground self-start px-1.5 text-2xs" />}
          >
            +{items.length - CHIPS_PER_DAY} more
          </PopoverTrigger>
          <PopoverContent align="start" className="flex w-64 flex-col gap-1 p-2">
            <p className="text-muted-foreground px-1 pb-1 text-xs font-medium">{day}</p>
            {items.map((task) => (
              <CalendarChip key={task.id} task={task} onOpen={() => onOpenTask(task.id)} />
            ))}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

/** A Task on a day: its Project's colour, its status, its title, its assignee. Draggable to another day. */
function CalendarChip({ task, onOpen }: { task: Task; onOpen: () => void }) {
  const dir = useWorkDirectory();
  const ref = useRef<HTMLButtonElement>(null);
  const dragging = useDraggableTask(ref, task.id, { disabled: !dir.canEdit });
  const project = dir.project(task.projectId);
  const done = task.status === "done";
  // The chip truncates the title, so the whole of it is a hover away.
  return (
    <Hint label={task.title}>
      <button
        ref={ref}
        type="button"
        onClick={onOpen}
        data-dragging={dragging || undefined}
        className={cn(
          "press-control border-alpha-medium hover:border-alpha-strong flex h-5.5 w-full min-w-0 shrink-0 items-center gap-1.25 rounded-sm border px-1.5 text-left text-xs data-[dragging]:opacity-40",
          project ? TONE_FILL[project.color] : "bg-alpha-light",
          done && "opacity-55"
        )}
      >
        <TaskStatusIcon status={task.status} className="size-3 shrink-0" />
        <span className={cn("min-w-0 flex-1 truncate", done && "line-through decoration-1")}>{task.title}</span>
        {task.assigneeMemberId && <WorkAvatar person={dir.person(task.assigneeMemberId)} size="xs" className="ring-0" />}
      </button>
    </Hint>
  );
}

function WeekView({ day, ...props }: DayProps & { day: string }) {
  return (
    <div role="grid" aria-label={weekLabel(day)} className="grid min-h-0 flex-1 grid-cols-7 overflow-auto">
      {weekGrid(day).map((date) => (
        <WeekColumn key={date} day={date} {...props} />
      ))}
    </div>
  );
}

function WeekColumn({ day, byDay, today, canCreate, onCreate, onOpenTask, onReschedule }: DayProps & { day: string }) {
  const dir = useWorkDirectory();
  const ref = useRef<HTMLDivElement>(null);
  const target = useTaskDropTarget(ref, { data: { kind: "day", day }, disabled: !canCreate, onDrop: (id) => onReschedule(id, day) });
  const items = byDay.get(day) ?? [];
  const isToday = day === today;
  return (
    <div role="gridcell" aria-label={day} className="border-alpha-medium flex min-w-0 flex-col border-r last:border-r-0">
      <div className="group/head border-alpha-medium flex items-center gap-1.5 border-b p-2.5">
        <span className={cn("text-xl font-semibold tracking-tight tabular-nums", isToday && "text-primary")}>{Number(day.slice(8))}</span>
        <span className="text-muted-foreground text-xs">{WEEKDAY_LABELS[weekdayIndex(day)]}</span>
        <span className="flex-1" />
        {canCreate && (
          <button
            type="button"
            aria-label={`Add task on ${day}`}
            onClick={() => onCreate(day)}
            className="press-control text-muted-foreground hover:bg-alpha-light hover:text-foreground grid size-6 place-items-center rounded-md opacity-0 group-hover/head:opacity-100 [@media(hover:none)]:opacity-100 focus-visible:opacity-100"
          >
            <Plus className="size-3.5" />
          </button>
        )}
      </div>
      <div ref={ref} data-over={target.over || undefined} className="data-[over]:bg-tone-blue flex flex-1 flex-col gap-1.5 p-2">
        {items.length ? (
          items.map((task) => <WeekCard key={task.id} task={task} onOpen={() => onOpenTask(task.id)} keyOf={dir.keyOf} />)
        ) : (
          <span className="text-muted-foreground p-1 text-xs">No tasks</span>
        )}
      </div>
    </div>
  );
}

function WeekCard({ task, onOpen, keyOf }: { task: Task; onOpen: () => void; keyOf: (t: Task) => string }) {
  const dir = useWorkDirectory();
  const ref = useRef<HTMLButtonElement>(null);
  const dragging = useDraggableTask(ref, task.id, { disabled: !dir.canEdit });
  const project = dir.project(task.projectId);
  return (
    <button
      ref={ref}
      type="button"
      onClick={onOpen}
      data-dragging={dragging || undefined}
      className="press bg-content border-alpha-medium hover:border-alpha-strong flex flex-col gap-1.25 rounded-md border px-2 py-1.75 text-left text-sm data-[dragging]:opacity-40"
    >
      <span className="flex min-w-0 items-start gap-1.75 leading-tight font-medium">
        {project && <i aria-hidden className={cn("mt-1 size-2 shrink-0 rounded-sm", TONE_FILL[project.color])} />}
        <span className={cn("min-w-0", task.status === "done" && "text-muted-foreground line-through decoration-1")}>{task.title}</span>
      </span>
      <span className="text-muted-foreground flex items-center gap-1.5 text-2xs">
        <TaskStatusIcon status={task.status} className="size-3" />
        <span className="font-mono">{keyOf(task)}</span>
        <PriorityIcon priority={task.priority} className="size-3" />
        <span className="flex-1" />
        {task.assigneeMemberId && <WorkAvatar person={dir.person(task.assigneeMemberId)} size="xs" />}
      </span>
    </button>
  );
}
