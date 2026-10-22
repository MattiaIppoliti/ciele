"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type CSSProperties, type KeyboardEvent, type RefObject } from "react";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  ChevronRight,
  CircleCheck,
  Copy,
  Ellipsis,
  GripVertical,
  ListTree,
  Plus,
  Repeat,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { Input } from "@agent-hub/ui";
import type { Task, TaskLabelLink, WorkGroupField, WorkViewQuery } from "@agent-hub/core";
import {
  MY_TASK_GROUPS,
  addDays,
  compareTasks,
  groupPatch,
  groupTasks,
  matchesWorkQuery,
  myTaskGroup,
  type MyTaskGroup,
} from "@agent-hub/core";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { RollInText, RollRow } from "@/components/motion/roll-in-text";
import { RollingNumber } from "@/components/motion/rolling-number";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { groupTitle } from "@/lib/work/work-format";
import { dropPosition, isNoOpDrop, stepPosition } from "@/lib/work/drop-position";
import { SpringSpan } from "@/components/motion/layout-spring";
import { useDraggableTask, useTaskDropTarget } from "@/lib/drag/drag-adapter";
import { useTaskMutations } from "./use-task-mutations";
import { bulkUpdateTasksAction, createTaskAction, setFavoriteAction } from "@/app/work-actions";
import { PriorityIcon, ProjectGlyph, TaskStatusIcon } from "./work-icons";
import { AssigneePicker, PriorityPicker, StatusPicker } from "./task-pickers";
import { TaskCell, type TaskCellKey, type TaskPatch } from "./task-cells";
import { useWorkDirectory } from "./work-directory";
import { useWorkViewContext } from "./use-work-view-context";
import { useCollapsedGroups } from "./use-collapsed-groups";
import { WorkAvatar } from "./work-ui";

/**
 * The List layout (#1050, #1063): Tasks grouped by the view's group field, an
 * inline composer per group that sets the group's own value, inline rename,
 * a picker per cell, selection with a bulk bar, and subtasks unfolded under
 * their parent. Every change is optimistic and settles from the server's
 * answer, which also carries the refreshed page (ADR-0005).
 *
 * One grid shared by a sticky 32px header and 40px rows (drag handle and
 * checkbox hanging in the left gutter, then the title, status, assignee,
 * priority, due date and labels), ruled groups, a sunken band for subtasks and
 * a floating bulk bar. A row moves by its handle, or by Alt+Up/Down and its
 * menu from the keyboard (#1064).
 */

type Scope = "project" | "my-tasks" | "all-tasks";

export interface TaskListProps {
  tasks: Task[];
  labelLinks: TaskLabelLink[];
  query: WorkViewQuery;
  scope: Scope;
  /** The Project a composer adds to, on a Project page. */
  projectId?: string;
  /** A private Project's members, to scope the assignee picker. */
  projectMemberIds?: string[] | null;
  onOpenTask: (id: string) => void;
  openTaskId: string | null;
  /** A drop reorders by hand, so the view switches to the manual sort. */
  onSortManual?: () => void;
}

type Column = "handle" | "check" | "title" | "more" | Exclude<TaskCellKey, "start">;

/** Each column's track and the narrowest list it still fits in. */
const COLUMNS: { key: Column; track: string; from: number; label: string }[] = [
  { key: "handle", track: "18px", from: 0, label: "" },
  { key: "check", track: "30px", from: 0, label: "" },
  { key: "title", track: "minmax(220px,1fr)", from: 0, label: "Task" },
  { key: "project", track: "150px", from: 1100, label: "Project" },
  { key: "status", track: "126px", from: 560, label: "Status" },
  { key: "assignee", track: "150px", from: 700, label: "Assignee" },
  { key: "priority", track: "108px", from: 820, label: "Priority" },
  { key: "due", track: "104px", from: 0, label: "Due date" },
  { key: "labels", track: "168px", from: 980, label: "Labels" },
  { key: "more", track: "40px", from: 0, label: "" },
];

function useListColumns(
  ref: RefObject<HTMLElement | null>,
  scope: Scope
): { columns: Column[]; style: CSSProperties; width: number } {
  // Server-rendered wide; the first measurement narrows it.
  const [width, setWidth] = useState(1280);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(() => setWidth(node.clientWidth));
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return useMemo(() => {
    const shown = COLUMNS.filter(
      (c) =>
        width >= c.from &&
        !(c.key === "project" && scope === "project") &&
        !(c.key === "assignee" && scope === "my-tasks")
    );
    return {
      columns: shown.map((c) => c.key),
      style: { gridTemplateColumns: shown.map((c) => c.track).join(" ") },
      // What moves a cell: the list's width, and so which columns it shows.
      width,
    };
  }, [width, scope]);
}

export function TaskList({
  tasks,
  labelLinks,
  query,
  scope,
  projectId,
  projectMemberIds,
  onOpenTask,
  openTaskId,
  onSortManual,
}: TaskListProps) {
  const dir = useWorkDirectory();
  const mutations = useTaskMutations(tasks);
  const optimistic = mutations.tasks;
  const { confirmDeleteModal } = mutations;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const rootRef = useRef<HTMLDivElement>(null);
  const grid = useListColumns(rootRef, scope);

  const labelsOf = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const link of labelLinks) map.set(link.taskId, [...(map.get(link.taskId) ?? []), link.labelId]);
    return (id: string) => map.get(id) ?? [];
  }, [labelLinks]);

  const ctx = useWorkViewContext(labelsOf);

  // Rows: top-level Tasks on a Project or the Organization list; every Task
  // assigned to me on My Tasks, subtasks included (a subtask is work too).
  const subtasksOf = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of optimistic) {
      if (task.parentId) map.set(task.parentId, [...(map.get(task.parentId) ?? []), task]);
    }
    for (const list of map.values()) list.sort((a, b) => (a.rank < b.rank ? -1 : 1));
    return map;
  }, [optimistic]);
  const rows = useMemo(
    () =>
      optimistic
        .filter((task) => (scope === "my-tasks" ? true : task.parentId === null))
        .filter((task) => matchesWorkQuery(task, query, ctx))
        .sort(compareTasks(query.sort, ctx)),
    [optimistic, scope, query, ctx]
  );
  // My Tasks has fixed groups (#1050): Overdue, Today, Upcoming, No due date,
  // Completed. Today always shows, so there is somewhere to add one.
  const groups = useMemo(
    () =>
      scope === "my-tasks"
        ? MY_TASK_GROUPS.map((key) => ({ key, tasks: rows.filter((task) => myTaskGroup(task, dir.today) === key) })).filter(
            (group) => group.tasks.length || group.key === "today"
          )
        : groupTasks(rows, query.group, ctx),
    [scope, rows, query.group, ctx, dir.today]
  );

  /**
   * A row dropped on another row (#1064): a new place in the order, and, when
   * the list is grouped and the row crossed into another group, that group's
   * value. Manual order only means something under the manual sort, so a drop
   * switches the view to it.
   */
  const dropOnRow = (taskId: string, target: Task, edge: "top" | "bottom" | null, groupKey: string, groupTasks: Task[]) => {
    const task = optimistic.find((t) => t.id === taskId);
    if (!task || task.id === target.id) return;
    const ids = groupTasks.map((t) => t.id);
    const position = dropPosition(ids, task.id, target.id, edge);
    const crossing = scope !== "my-tasks" && query.group !== "none" && !groupTasks.some((t) => t.id === task.id);
    const patch = crossing ? groupPatch(query.group, groupKey, dir.today) : {};
    if (!crossing && isNoOpDrop(ids, task.id, position)) return;
    if ("projectId" in patch && patch.projectId && patch.projectId !== task.projectId) {
      toast.info("Move it to another project from its menu: moving changes its key.");
      return;
    }
    mutations.move(task, patch as TaskPatch, position);
    if (query.sort.field !== "manual") onSortManual?.();
  };

  /** The keyboard's drop: one place up or down within the row's group, as a drop there would do. */
  const stepRow = (task: Task, direction: -1 | 1, groupTasks: Task[]) => {
    const position = stepPosition(
      groupTasks.map((t) => t.id),
      task.id,
      direction
    );
    if (!position) return;
    mutations.move(task, {}, position);
    if (query.sort.field !== "manual") onSortManual?.();
  };

  const toggleSelected = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const bulk = (patch: Parameters<typeof bulkUpdateTasksAction>[0]["patch"]) => mutations.bulk([...selected], patch);
  const remove = (ids: string[]) => mutations.remove(ids, () => setSelected(new Set()));
  const archive = (ids: string[]) => mutations.archive(ids, () => setSelected(new Set()));

  if (!optimistic.some((task) => scope === "my-tasks" || !task.parentId) && scope !== "project") {
    return (
      <EmptyState
        className="flex-1"
        title={scope === "my-tasks" ? "Nothing assigned to you" : "No tasks yet"}
        description={scope === "my-tasks" ? "Tasks assigned to you in any project show up here." : ""}
      />
    );
  }

  const allIds = rows.map((task) => task.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const someSelected = allIds.some((id) => selected.has(id));

  return (
    <div ref={rootRef} className="flex min-h-0 flex-col pr-6 pl-0.5">
      <div role="table" aria-label="Tasks" className="min-w-0">
        <div
          role="row"
          style={grid.style}
          className="bg-content border-alpha-medium text-muted-foreground sticky top-0 z-[2] grid min-h-8 items-center border-b text-xs font-medium"
        >
          {grid.columns.map((column) => (
            <SpringSpan key={column} dependency={grid.width} role="columnheader" className="flex min-w-0 items-center px-2">
              {column === "check" && dir.canEdit ? (
                <Checkbox
                  aria-label="Select all"
                  checked={allSelected}
                  indeterminate={!allSelected && someSelected}
                  onCheckedChange={(checked) => setSelected(checked ? new Set(allIds) : new Set())}
                />
              ) : (
                <span className={cn("truncate", !COLUMNS.find((c) => c.key === column)?.label && "sr-only")}>
                  {COLUMNS.find((c) => c.key === column)?.label || column}
                </span>
              )}
            </SpringSpan>
          ))}
        </div>
        {groups.map((group) => (
          <TaskGroup
            key={group.key}
            grid={grid}
            groupField={query.group}
            groupKey={group.key}
            tasks={group.tasks}
            scope={scope}
            projectId={projectId}
            projectMemberIds={projectMemberIds}
            labelsOf={labelsOf}
            subtasksOf={subtasksOf}
            expanded={expanded}
            onToggleExpanded={(id) =>
              setExpanded((current) => {
                const next = new Set(current);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
            selected={selected}
            onToggleSelected={toggleSelected}
            onOpenTask={onOpenTask}
            openTaskId={openTaskId}
            onUpdate={(task, patch) => mutations.update(task, patch)}
            onLabels={(task, labelIds) => mutations.update(task, {}, { labelIds })}
            onArchive={(id) => archive([id])}
            onDelete={(id) => remove([id])}
            onDropOnRow={(id, target, edge) => dropOnRow(id, target, edge, group.key, group.tasks)}
            onStepRow={(task, direction) => stepRow(task, direction, group.tasks)}
          />
        ))}
      </div>
      {selected.size > 0 && (
        <BulkBar
          count={selected.size}
          onStatus={(status) => bulk({ status })}
          onPriority={(priority) => bulk({ priority })}
          onAssignee={(assigneeMemberId) => bulk({ assigneeMemberId })}
          onArchive={() => archive([...selected])}
          onDelete={() => remove([...selected])}
          onClear={() => setSelected(new Set())}
          canEdit={dir.canEdit}
        />
      )}
      {confirmDeleteModal}
    </div>
  );
}

type Grid = ReturnType<typeof useListColumns>;

const BULK_BUTTON =
  "press-control text-background/85 hover:bg-background/15 hover:text-background data-[popup-open]:bg-background/15 inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-sm";

/** The selection's actions, floating over the list's foot. */
function BulkBar({
  count,
  onStatus,
  onPriority,
  onAssignee,
  onArchive,
  onDelete,
  onClear,
  canEdit,
}: {
  count: number;
  onStatus: (status: Task["status"]) => void;
  onPriority: (priority: Task["priority"]) => void;
  onAssignee: (assignee: string | null) => void;
  onArchive: () => void;
  onDelete: () => void;
  onClear: () => void;
  canEdit: boolean;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Selected tasks"
      className="bg-foreground text-background shadow-strong fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-xl py-1.5 pr-1.5 pl-3.5 text-sm"
    >
      <span className="mr-1 font-medium whitespace-nowrap">
        <RollingNumber value={count} /> selected
      </span>
      {canEdit && (
        <>
          <span aria-hidden className="bg-background/20 mx-1 h-4.5 w-px" />
          <StatusPicker value="to_do" onChange={onStatus} trigger={<button type="button" className={BULK_BUTTON}>Status</button>} />
          <PriorityPicker value="none" onChange={onPriority} trigger={<button type="button" className={BULK_BUTTON}>Priority</button>} />
          <AssigneePicker value={null} onChange={onAssignee} trigger={<button type="button" className={BULK_BUTTON}>Assignee</button>} />
          <button type="button" className={BULK_BUTTON} onClick={onArchive}>
            <Archive className="size-3.5" /> Archive
          </button>
          <button type="button" className={cn(BULK_BUTTON, "hover:text-tone-red")} onClick={onDelete}>
            <Trash2 className="size-3.5" /> Delete
          </button>
          <span aria-hidden className="bg-background/20 mx-1 h-4.5 w-px" />
        </>
      )}
      <button type="button" className={BULK_BUTTON} aria-label="Clear selection" onClick={onClear}>
        <X className="size-4" />
      </button>
    </div>
  );
}

function TaskGroup({
  grid,
  groupField,
  groupKey,
  tasks,
  scope,
  projectId,
  projectMemberIds,
  labelsOf,
  subtasksOf,
  expanded,
  onToggleExpanded,
  selected,
  onToggleSelected,
  onOpenTask,
  openTaskId,
  onUpdate,
  onLabels,
  onArchive,
  onDelete,
  onDropOnRow,
  onStepRow,
}: {
  grid: Grid;
  groupField: WorkGroupField;
  groupKey: string;
  tasks: Task[];
  scope: Scope;
  projectId?: string;
  projectMemberIds?: string[] | null;
  labelsOf: (id: string) => string[];
  subtasksOf: Map<string, Task[]>;
  expanded: Set<string>;
  onToggleExpanded: (id: string) => void;
  selected: Set<string>;
  onToggleSelected: (id: string) => void;
  onOpenTask: (id: string) => void;
  openTaskId: string | null;
  onUpdate: (task: Task, patch: TaskPatch) => void;
  onLabels: (task: Task, labelIds: string[]) => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
  onDropOnRow: (taskId: string, target: Task, edge: "top" | "bottom" | null) => void;
  onStepRow: (task: Task, direction: -1 | 1) => void;
}) {
  const dir = useWorkDirectory();
  const mine = scope === "my-tasks";
  // My Tasks folds Completed until the Member opens it; every choice is remembered.
  const folded = useCollapsedGroups(`work.${scope}.${groupField}.collapsed`, (key) => mine && key === "completed");
  const collapsed = folded.isCollapsed(groupKey);
  const setCollapsed = (next: boolean) => folded.setCollapsed(groupKey, next);
  const [composing, setComposing] = useState(false);
  const title = mine
    ? MY_GROUP_TITLES[groupKey as MyTaskGroup]
    : groupField === "none"
      ? ""
      : groupTitle(groupField, groupKey, {
          person: (id) => dir.person(id)?.name ?? "Someone",
          project: (id) => dir.project(id)?.name ?? "Project",
        });
  const preset = mine ? myGroupPreset(groupKey as MyTaskGroup, dir.today, dir.viewerId) : groupPatch(groupField, groupKey, dir.today);
  const composeProject = projectId ?? (groupField === "project" ? groupKey : undefined);
  const canCompose = dir.canEdit && Boolean(composeProject ?? dir.projects[0]?.id);
  const groupProject = groupField === "project" ? dir.project(groupKey) : null;

  const row = (task: Task, nested: boolean) => (
    <TaskRow
      key={task.id}
      grid={grid}
      task={task}
      scope={scope}
      nested={nested}
      labelIds={labelsOf(task.id)}
      subtasks={nested ? [] : (subtasksOf.get(task.id) ?? [])}
      expanded={!nested && expanded.has(task.id)}
      onToggleExpanded={() => onToggleExpanded(task.id)}
      selected={selected.has(task.id)}
      onToggleSelected={() => onToggleSelected(task.id)}
      open={openTaskId === task.id}
      onOpen={() => onOpenTask(task.id)}
      onUpdate={(patch) => onUpdate(task, patch)}
      onLabels={(labelIds) => onLabels(task, labelIds)}
      onArchive={() => onArchive(task.id)}
      onDelete={() => onDelete(task.id)}
      projectMemberIds={projectMemberIds}
      // Order means nothing on My Tasks, nor among a parent's subtasks here.
      onDropOnRow={mine || nested ? undefined : (id, edge) => onDropOnRow(id, task, edge)}
      onStep={mine || nested ? undefined : (direction) => onStepRow(task, direction)}
    />
  );

  return (
    <div role="rowgroup" aria-label={title || "Tasks"}>
      {(groupField !== "none" || mine) && (
        <div role="row" className="group/heading border-alpha-medium flex h-9 items-center gap-2 border-b pr-2 pl-5.5">
          <span role="cell" className="flex min-w-0 flex-1 items-center gap-2">
            <button
              type="button"
              className="press-text flex min-w-0 items-center gap-2 text-sm font-semibold"
              aria-expanded={!collapsed}
              onClick={() => setCollapsed(!collapsed)}
            >
              <ChevronRight aria-hidden className={cn("text-muted-foreground size-3.5 transition-transform", !collapsed && "rotate-90")} />
              {groupField === "status" && !mine && <TaskStatusIcon status={groupKey as Task["status"]} className="size-3.5" />}
              {groupField === "priority" && !mine && <PriorityIcon priority={groupKey as Task["priority"]} className="size-3.5" />}
              {groupField === "assignee" && !mine && <WorkAvatar person={dir.person(groupKey)} size="xs" />}
              {groupProject && <ProjectGlyph icon={groupProject.icon} color={groupProject.color} className="size-3.5" />}
              <span className="truncate">{title}</span>
              <RollingNumber value={tasks.length} className="text-muted-foreground font-medium" />
            </button>
            {canCompose && (
              <button
                type="button"
                aria-label={`Add task to ${title}`}
                className="press-control text-muted-foreground hover:bg-alpha-light hover:text-foreground grid size-6 place-items-center rounded-md opacity-60 group-hover/heading:opacity-100"
                onClick={() => {
                  setCollapsed(false);
                  setComposing(true);
                }}
              >
                <Plus className="size-3.5" />
              </button>
            )}
          </span>
        </div>
      )}
      {!collapsed && (
        <>
          {tasks.map((task, index) => (
            <RollRow key={task.id} index={index}>
              <div role="presentation">
                {row(task, false)}
                {scope !== "my-tasks" && expanded.has(task.id) && (subtasksOf.get(task.id) ?? []).map((sub) => row(sub, true))}
              </div>
            </RollRow>
          ))}
          {canCompose &&
            (composing ? (
              <Composer
                projectId={composeProject ?? dir.projects[0]!.id}
                preset={preset}
                onDone={() => setComposing(false)}
              />
            ) : (
              <button
                type="button"
                className="press text-muted-foreground hover:bg-alpha-lighter hover:text-foreground border-alpha-medium flex h-8.5 w-full items-center gap-2 border-b pr-2 pl-6.5 text-left text-sm"
                onClick={() => setComposing(true)}
              >
                <Plus aria-hidden className="size-3.5" /> Add task
              </button>
            ))}
          {!tasks.length && !canCompose && (
            <p className="text-muted-foreground border-alpha-medium border-b py-2 pl-6.5 text-sm">No tasks.</p>
          )}
        </>
      )}
    </div>
  );
}

const MY_GROUP_TITLES: Record<MyTaskGroup, string> = {
  overdue: "Overdue",
  today: "Today",
  upcoming: "Upcoming",
  no_date: "No due date",
  completed: "Completed",
};

/** What a Task added in a My Tasks group gets: always mine, and the group's date or state. */
function myGroupPreset(group: MyTaskGroup, today: string, me: string) {
  const base = { assigneeMemberId: me };
  switch (group) {
    case "overdue":
    case "today":
      return { ...base, dueDate: today };
    case "upcoming":
      return { ...base, dueDate: addDays(today, 3) };
    case "completed":
      return { ...base, status: "done" as const };
    case "no_date":
      return base;
  }
}

function Composer({
  projectId,
  preset,
  onDone,
}: {
  projectId: string;
  preset: Partial<Pick<Task, "status" | "priority" | "assigneeMemberId" | "projectId" | "dueDate">>;
  onDone: () => void;
}) {
  const [title, setTitle] = useState("");
  const [pending, startTransition] = useTransition();
  const submit = () => {
    const value = title.trim();
    if (!value) return onDone();
    startTransition(async () => {
      const { projectId: groupProject, ...rest } = preset;
      const result = await createTaskAction({ projectId: groupProject ?? projectId, title: value, ...rest });
      if (!result.ok) return toast.error(result.error);
      setTitle("");
    });
  };
  return (
    <form
      className="border-alpha-medium flex h-10 items-center gap-2 border-b pr-2.5 pl-6"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <TaskStatusIcon status={preset.status ?? "to_do"} className="size-3.5" />
      <Input
        autoFocus
        value={title}
        disabled={pending}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key === "Escape") onDone();
        }}
        onBlur={() => !title.trim() && onDone()}
        placeholder="Task name, then Enter"
        aria-label="New task name"
        className="h-8 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
      />
    </form>
  );
}

interface TaskRowProps {
  grid: Grid;
  task: Task;
  scope: Scope;
  nested: boolean;
  labelIds: string[];
  subtasks: Task[];
  expanded: boolean;
  onToggleExpanded: () => void;
  selected: boolean;
  onToggleSelected: () => void;
  open: boolean;
  onOpen: () => void;
  onUpdate: (patch: TaskPatch) => void;
  onLabels: (labelIds: string[]) => void;
  onArchive: () => void;
  onDelete: () => void;
  projectMemberIds?: string[] | null;
  /** Dropping another row on this one; absent where order means nothing. */
  onDropOnRow?: (taskId: string, edge: "top" | "bottom" | null) => void;
  /** One place up or down from the keyboard; absent where order means nothing. */
  onStep?: (direction: -1 | 1) => void;
}

function TaskRow(props: TaskRowProps) {
  const { grid, task, nested, labelIds, selected, onToggleSelected, open, onUpdate, onLabels, projectMemberIds, onDropOnRow, onStep } = props;
  const dir = useWorkDirectory();
  const rowRef = useRef<HTMLDivElement>(null);
  const gripRef = useRef<HTMLButtonElement>(null);
  const editable = dir.canEdit;
  const draggable = editable && Boolean(onDropOnRow);
  const movable = editable && Boolean(onStep);
  const dragging = useDraggableTask(rowRef, task.id, { disabled: !draggable, handleRef: gripRef });
  const target = useTaskDropTarget(rowRef, {
    data: { kind: "row", taskId: task.id },
    edges: true,
    disabled: !draggable,
    onDrop: (id, edge) => onDropOnRow?.(id, edge),
  });

  // Alt+Up/Down from anywhere in the row. A picker's popover is portalled out
  // of the row, so keys typed in it never move the row.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!movable || !event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    if (!event.currentTarget.contains(event.target as Node) || (event.target as HTMLElement).closest("input, textarea")) return;
    event.preventDefault();
    onStep?.(event.key === "ArrowUp" ? -1 : 1);
  };

  const cell = (column: Column) => {
    switch (column) {
      case "handle":
        return draggable ? (
          <button
            ref={gripRef}
            type="button"
            tabIndex={-1}
            aria-hidden
            className="text-muted-foreground/60 hover:text-foreground flex h-10 w-full cursor-grab items-center justify-center opacity-0 group-hover/row:opacity-100"
          >
            <GripVertical className="size-3.5" />
          </button>
        ) : null;
      case "check":
        return editable ? <Checkbox aria-label={`Select ${task.title}`} checked={selected} onCheckedChange={onToggleSelected} /> : null;
      case "title":
        return <TaskTitleCell {...props} movable={movable} />;
      case "more":
        return <TaskRowMenu {...props} movable={movable} />;
      default:
        return (
          <TaskCell
            column={column}
            task={task}
            labelIds={labelIds}
            editable={editable}
            projectMemberIds={projectMemberIds}
            layout="list"
            onPatch={onUpdate}
            onLabels={onLabels}
          />
        );
    }
  };

  return (
    <div
      ref={rowRef}
      role="row"
      // No aria-selected: it is not allowed on a row of a `table`, and the
      // row's checkbox already says whether it is selected.
      data-open={open || undefined}
      data-selected={selected || undefined}
      data-dragging={dragging || undefined}
      style={grid.style}
      onKeyDown={onKeyDown}
      className={cn(
        "group/row border-alpha-medium hover:bg-alpha-lighter data-[open]:bg-alpha-light data-[selected]:bg-tone-blue relative grid items-center border-b data-[dragging]:opacity-40",
        nested ? "bg-alpha-lighter min-h-8" : "min-h-10"
      )}
    >
      {target.edge && (
        <span aria-hidden className={cn("bg-ring absolute inset-x-0 z-10 h-0.5 rounded-full", target.edge === "top" ? "-top-px" : "-bottom-px")} />
      )}
      {grid.columns.map((column) => (
        <SpringSpan
          key={column}
          dependency={grid.width}
          role="cell"
          className={cn(
            "flex min-w-0 items-center gap-1.5",
            column === "handle" ? "justify-center" : column === "check" ? "justify-center px-1" : "px-2",
            column === "title" && "gap-2"
          )}
        >
          {cell(column)}
        </SpringSpan>
      ))}
    </div>
  );
}

/** The title cell: the subtask disclosure, the key, the title (double-click renames) and its markers. */
function TaskTitleCell({
  task,
  scope,
  nested,
  subtasks,
  expanded,
  onToggleExpanded,
  onOpen,
  onUpdate,
  movable,
}: TaskRowProps & { movable: boolean }) {
  const dir = useWorkDirectory();
  const [renaming, setRenaming] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const doneSubtasks = subtasks.filter((s) => s.status === "done").length;

  const commitTitle = () => {
    const value = titleRef.current?.value.trim() ?? "";
    setRenaming(false);
    if (value && value !== task.title) onUpdate({ title: value });
  };

  return (
    <>
      <span className={cn("flex w-3.5 shrink-0 justify-center", nested && "ml-5")}>
        {!nested && subtasks.length > 0 && scope !== "my-tasks" ? (
          <button
            type="button"
            className="press-control text-muted-foreground hover:text-foreground"
            aria-label={expanded ? "Hide subtasks" : "Show subtasks"}
            aria-expanded={expanded}
            onClick={onToggleExpanded}
          >
            <ChevronRight aria-hidden className={cn("size-3.5 transition-transform", expanded && "rotate-90")} />
          </button>
        ) : nested ? (
          <TaskStatusIcon status={task.status} className="size-3.5" />
        ) : null}
      </span>
      <span className="text-muted-foreground shrink-0 font-mono text-2xs">{dir.keyOf(task)}</span>
      {renaming ? (
        <Input
          ref={titleRef}
          autoFocus
          defaultValue={task.title}
          aria-label="Task name"
          className="h-7"
          onBlur={commitTitle}
          onKeyDown={(event) => {
            if (event.key === "Enter") commitTitle();
            if (event.key === "Escape") setRenaming(false);
          }}
        />
      ) : (
        <button
          type="button"
          aria-keyshortcuts={movable ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
          className={cn(
            "press-text min-w-0 truncate text-left text-sm decoration-1 underline-offset-2 hover:underline",
            task.status === "done" && "text-muted-foreground line-through hover:line-through"
          )}
          onClick={onOpen}
          onDoubleClick={() => dir.canEdit && setRenaming(true)}
        >
          <RollInText text={task.title} />
        </button>
      )}
      {task.recurrence && <Repeat aria-label="Repeats" className="text-muted-foreground size-3 shrink-0" />}
      {subtasks.length > 0 && (
        <span
          className="text-muted-foreground inline-flex shrink-0 items-center gap-0.75 text-2xs"
          aria-label={`${doneSubtasks} of ${subtasks.length} subtasks done`}
        >
          <ListTree aria-hidden className="size-3" /> <RollInText text={`${doneSubtasks}/${subtasks.length}`} />
        </span>
      )}
      {scope === "my-tasks" && task.parentId && <span className="text-muted-foreground shrink-0 text-2xs">subtask</span>}
    </>
  );
}

/** A row's menu: open, complete, move, favourite, copy link, archive, delete. */
function TaskRowMenu({ task, onOpen, onUpdate, onArchive, onDelete, onStep, movable }: TaskRowProps & { movable: boolean }) {
  const dir = useWorkDirectory();
  const editable = dir.canEdit;
  const favorite = dir.isFavorite({ taskId: task.id });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={`More for ${task.title}`}
            className="press-control text-muted-foreground hover:bg-alpha-light hover:text-foreground data-[popup-open]:bg-alpha-light grid size-7 place-items-center rounded-md opacity-0 group-hover/row:opacity-100 [@media(hover:none)]:opacity-100 focus-visible:opacity-100 data-[popup-open]:opacity-100"
          />
        }
      >
        <Ellipsis className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onClick={onOpen}>Open</DropdownMenuItem>
        {editable && (
          <DropdownMenuItem onClick={() => onUpdate({ status: task.status === "done" ? "to_do" : "done" })}>
            <CircleCheck className="size-4" /> {task.status === "done" ? "Reopen" : "Mark complete"}
          </DropdownMenuItem>
        )}
        {movable && (
          <>
            <DropdownMenuItem onClick={() => onStep?.(-1)}>
              <ArrowUp className="size-4" /> Move up
              <span className="text-muted-foreground ml-auto text-xs">Alt ↑</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onStep?.(1)}>
              <ArrowDown className="size-4" /> Move down
              <span className="text-muted-foreground ml-auto text-xs">Alt ↓</span>
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuItem onClick={() => void setFavoriteAction({ taskId: task.id }, !favorite)}>
          <Star className="size-4" /> {favorite ? "Remove from favorites" : "Add to favorites"}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            void navigator.clipboard.writeText(`${window.location.origin}/tasks/${task.id}`);
            toast.success("Link copied");
          }}
        >
          <Copy className="size-4" /> Copy link
        </DropdownMenuItem>
        {editable && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onArchive}>
              <Archive className="size-4" /> Archive
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2 className="size-4" /> Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
