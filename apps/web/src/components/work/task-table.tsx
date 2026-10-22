"use client";

import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Columns3, GripVertical, Plus } from "lucide-react";
import { Input, Popover, PopoverContent, PopoverTrigger } from "@agent-hub/ui";
import type { Task, TaskLabelLink, WorkSortField, WorkViewQuery } from "@agent-hub/core";
import {
  compareTasks,
  formatEstimate,
  groupPatch,
  groupTasks,
  matchesWorkQuery,
  parseEstimate,
} from "@agent-hub/core";
import { Checkbox } from "@/components/ui/checkbox";
import { SortableHandle, SortableItem, SortableList } from "@/components/ui/sortable-list";
import { useTableOrder } from "@/components/ui/table-preferences";
import { SpringSpan } from "@/components/motion/layout-spring";
import { RollInText, RollRow } from "@/components/motion/roll-in-text";
import { RollingNumber } from "@/components/motion/rolling-number";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { formatWorkDay, groupTitle } from "@/lib/work/work-format";
import { createTaskAction } from "@/app/work-actions";
import { PriorityIcon, TaskStatusIcon } from "./work-icons";
import { TaskCell, type TaskCellKey } from "./task-cells";
import {
  MIN_TABLE_COLUMN_WIDTH,
  moveColumn,
  readColumnLayout,
  readColumnWidths,
  writeColumnLayout,
  writeColumnWidths,
} from "./table-layout";
import { useTaskMutations } from "./use-task-mutations";
import { useWorkDirectory } from "./work-directory";
import { useWorkViewContext } from "./use-work-view-context";
import { PillButton } from "./work-ui";

/**
 * The Table layout (#1064): a full-bleed sheet with a sticky header and a
 * sticky first column, 36px rows ruled on both edges, group rows sunk below the
 * sheet, and every cell its own picker. Columns are shown, hidden and
 * reordered from the toolbar and resized by their header's edge, all kept
 * through the console's table preferences, per Organization and Member, on
 * this browser (#1050). A header click sorts through the view's query, so the
 * URL keeps the sort like every other layout.
 */

export type TableColumn = TaskCellKey | "deps" | "estimate" | "created";

export const TABLE_COLUMNS: { key: TableColumn; label: string; width: number }[] = [
  { key: "status", label: "Status", width: 132 },
  { key: "priority", label: "Priority", width: 112 },
  { key: "assignee", label: "Assignee", width: 156 },
  { key: "due", label: "Due date", width: 112 },
  { key: "start", label: "Start date", width: 112 },
  { key: "labels", label: "Labels", width: 180 },
  { key: "deps", label: "Dependencies", width: 150 },
  { key: "estimate", label: "Estimate", width: 92 },
  { key: "created", label: "Created", width: 112 },
  { key: "project", label: "Project", width: 156 },
];
const TABLE_KEYS = TABLE_COLUMNS.map((c) => c.key);
const COLUMN = new Map(TABLE_COLUMNS.map((c) => [c.key, c]));
const TITLE_WIDTH = 314;
const DEFAULT_HIDDEN: TableColumn[] = ["start", "deps", "created"];

const SORT_FOR: Partial<Record<TableColumn | "title", WorkSortField>> = {
  title: "title",
  status: "status",
  priority: "priority",
  assignee: "assignee",
  due: "due",
  start: "start",
  estimate: "estimate",
  created: "created",
  project: "project",
};

/** The Table's columns as this Member keeps them: order, visibility and widths. */
export function useTableColumns(scope: "project" | "all-tasks") {
  const [storedLayout, saveLayout] = useTableOrder(`work-tasks.${scope}`);
  const [storedWidths, saveWidths] = useTableOrder(`work-tasks.${scope}.widths`);
  const layout = readColumnLayout(storedLayout, TABLE_KEYS, DEFAULT_HIDDEN);
  // A Project's own table does not repeat its Project.
  const available = layout.order.filter((key) => !(scope === "project" && key === "project"));
  const widths = readColumnWidths(storedWidths, ["title", ...TABLE_KEYS]);
  const save = (order: TableColumn[], hidden: ReadonlySet<TableColumn>) => saveLayout(writeColumnLayout({ order, hidden }));
  return {
    available,
    shown: available.filter((key) => !layout.hidden.has(key)),
    hidden: layout.hidden,
    widths,
    setHidden: (key: TableColumn, hide: boolean) => {
      const hidden = new Set(layout.hidden);
      if (hide) hidden.add(key);
      else hidden.delete(key);
      save(layout.order, hidden);
    },
    /** A new order for `available`; a column outside it keeps its place at the end. */
    setOrder: (order: TableColumn[]) => save([...order, ...layout.order.filter((key) => !order.includes(key))], layout.hidden),
    move: (key: TableColumn, direction: -1 | 1) => save(moveColumn(layout.order, key, direction, available), layout.hidden),
    setWidth: (key: string, width: number) => saveWidths(writeColumnWidths({ ...widths, [key]: width })),
    reset: () => {
      saveLayout([]);
      saveWidths([]);
    },
  };
}

/** The toolbar's Columns control: show, hide and reorder (by drag, or Alt+Up/Down on a handle), reset. */
export function TableColumnsControl({ scope }: { scope: "project" | "all-tasks" }) {
  const columns = useTableColumns(scope);
  return (
    <Popover>
      <PopoverTrigger
        render={<PillButton className="text-muted-foreground hover:text-foreground data-[popup-open]:bg-alpha-light h-7 px-2 text-xs font-medium" />}
      >
        <Columns3 className="size-3.5" /> Columns
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1.5">
        <SortableList
          values={columns.available}
          onReorder={(next) => columns.setOrder(next as TableColumn[])}
          className="flex flex-col"
          aria-label="Columns"
        >
          {columns.available.map((key) => {
            const label = COLUMN.get(key)!.label;
            return (
              <SortableItem key={key} value={key} className="hover:bg-alpha-light bg-popover flex items-center gap-0.5 rounded-md pr-2 text-sm">
                <SortableHandle
                  aria-label={`Move ${label} column`}
                  aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                  onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
                    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
                    event.preventDefault();
                    columns.move(key, event.key === "ArrowUp" ? -1 : 1);
                  }}
                  className="press-control text-muted-foreground/60 hover:text-foreground grid size-7 shrink-0 cursor-grab touch-none place-items-center rounded-md active:cursor-grabbing"
                >
                  <GripVertical aria-hidden className="pointer-events-none size-3.5" />
                </SortableHandle>
                <label className="flex min-w-0 flex-1 items-center gap-2 py-1.5">
                  <Checkbox checked={!columns.hidden.has(key)} onCheckedChange={(on) => columns.setHidden(key, !on)} />
                  <span className="truncate">{label}</span>
                </label>
              </SortableItem>
            );
          })}
        </SortableList>
        <button
          type="button"
          onClick={columns.reset}
          className="press-text hover:bg-alpha-light text-muted-foreground mt-1 w-full rounded-md px-2 py-1.5 text-left text-sm"
        >
          Reset columns
        </button>
      </PopoverContent>
    </Popover>
  );
}

const TH = "bg-content border-alpha-medium text-muted-foreground sticky top-0 z-[3] h-[34px] border-r border-b px-2.5 text-left text-xs font-medium whitespace-nowrap select-none";
// The hover and open tints are translucent, so they go on as a background
// image over the opaque surface: as a background colour they replaced it, and
// the sticky first column turned see-through over the cells scrolling under it.
const TINT_HOVER = "group-hover/tr:bg-[image:linear-gradient(var(--alpha-lighter),var(--alpha-lighter))]";
const TINT_OPEN = "bg-[image:linear-gradient(var(--alpha-light),var(--alpha-light))]";
const TD = "bg-content " + TINT_HOVER + " border-alpha-medium h-9 overflow-hidden border-r border-b px-2.5 text-sm whitespace-nowrap";

export function TaskTable({
  tasks,
  labelLinks,
  dependencies,
  query,
  onQueryChange,
  scope,
  projectId,
  onOpenTask,
  openTaskId,
}: {
  tasks: Task[];
  labelLinks: TaskLabelLink[];
  dependencies: { taskId: string; blockedById: string }[];
  query: WorkViewQuery;
  onQueryChange: (next: WorkViewQuery) => void;
  scope: "project" | "all-tasks";
  projectId?: string;
  onOpenTask: (id: string) => void;
  openTaskId: string | null;
}) {
  const dir = useWorkDirectory();
  const mutations = useTaskMutations(tasks);
  const prefs = useTableColumns(scope);
  // A width being dragged shows at once; it is stored when the drag ends.
  const [draft, setDraft] = useState<{ key: string; width: number } | null>(null);
  const width = (key: string, fallback: number) => (draft?.key === key ? draft.width : (prefs.widths[key] ?? fallback));
  const columns = prefs.shown.map((key) => COLUMN.get(key)!);
  const total = width("title", TITLE_WIDTH) + columns.reduce((sum, c) => sum + width(c.key, c.width), 0);
  // What moves a cell: the columns' order and widths, so a column dragged wider
  // or moved springs the ones after it into place.
  const layoutKey = `${width("title", TITLE_WIDTH)}|${columns.map((c) => `${c.key}:${width(c.key, c.width)}`).join(",")}`;

  const labelsOf = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const link of labelLinks) map.set(link.taskId, [...(map.get(link.taskId) ?? []), link.labelId]);
    return (id: string) => map.get(id) ?? [];
  }, [labelLinks]);
  const blockers = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const edge of dependencies) map.set(edge.taskId, [...(map.get(edge.taskId) ?? []), edge.blockedById]);
    return map;
  }, [dependencies]);
  const ctx = useWorkViewContext(labelsOf);
  const rows = useMemo(
    () => mutations.tasks.filter((t) => !t.parentId && matchesWorkQuery(t, query, ctx)).sort(compareTasks(query.sort, ctx)),
    [mutations.tasks, query, ctx]
  );
  const groups = useMemo(() => groupTasks(rows, query.group, ctx), [rows, query.group, ctx]);
  const byId = useMemo(() => new Map(mutations.tasks.map((t) => [t.id, t])), [mutations.tasks]);

  const sortHeader = (key: TableColumn | "title", label: string) => {
    const field = SORT_FOR[key];
    const on = field && query.sort.field === field;
    return (
      <button
        type="button"
        disabled={!field}
        className="press-text hover:text-foreground flex w-full items-center gap-1 overflow-hidden disabled:cursor-default disabled:hover:text-inherit"
        onClick={() =>
          field &&
          onQueryChange({
            ...query,
            sort: { field, direction: on && query.sort.direction === "asc" ? "desc" : "asc" },
          })
        }
      >
        <span className="truncate">{label}</span>
        {on && (query.sort.direction === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
      </button>
    );
  };

  const resizer = (key: string, fallback: number) => (
    <ResizeEdge
      start={width(key, fallback)}
      onDraft={(next) => setDraft({ key, width: next })}
      onCommit={(next) => {
        setDraft(null);
        prefs.setWidth(key, next);
      }}
    />
  );

  const editable = dir.canEdit;
  const cell = (task: Task, key: TableColumn): ReactNode => {
    switch (key) {
      case "deps": {
        const ids = blockers.get(task.id) ?? [];
        return ids.length ? (
          <span className="flex gap-1">
            {ids.map((id) => {
              const blocker = byId.get(id);
              return blocker ? (
                <button
                  key={id}
                  type="button"
                  onClick={() => onOpenTask(id)}
                  className="press-control bg-alpha-medium text-muted-foreground hover:text-foreground rounded px-1.5 font-mono text-2xs"
                >
                  {dir.keyOf(blocker)}
                </button>
              ) : null;
            })}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        );
      }
      case "estimate":
        return <EstimateCell task={task} editable={editable} onCommit={(estimateMinutes) => mutations.update(task, { estimateMinutes })} />;
      case "created":
        return <span className="text-muted-foreground tabular-nums">{formatWorkDay(task.createdAt.slice(0, 10), dir.today)}</span>;
      default:
        return (
          <TaskCell
            column={key}
            task={task}
            labelIds={labelsOf(task.id)}
            editable={editable}
            layout="table"
            onPatch={(patch) => mutations.update(task, patch)}
            onLabels={(labelIds) => mutations.update(task, {}, { labelIds })}
          />
        );
    }
  };

  if (!rows.length && !mutations.tasks.some((t) => !t.parentId)) {
    return <p className="text-muted-foreground px-6 py-10 text-center text-sm">No tasks yet.</p>;
  }

  return (
    <div className="h-full min-h-0 overflow-auto">
      <table className="min-w-full table-fixed border-separate border-spacing-0" style={{ width: total }} aria-label="Tasks table">
        <colgroup>
          <col style={{ width: width("title", TITLE_WIDTH) }} />
          {columns.map((c) => (
            <col key={c.key} style={{ width: width(c.key, c.width) }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className={cn(TH, "left-0 z-[5] pl-6")}>
              {sortHeader("title", "Task")}
              {resizer("title", TITLE_WIDTH)}
            </th>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cn(TH, "relative")}>
                <SpringSpan dependency={layoutKey} className="block">
                  {sortHeader(c.key, c.label)}
                </SpringSpan>
                {resizer(c.key, c.width)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <GroupRows
              key={group.key}
              title={
                query.group === "none"
                  ? null
                  : groupTitle(query.group, group.key, {
                      person: (id) => dir.person(id)?.name ?? "Someone",
                      project: (id) => dir.project(id)?.name ?? "Project",
                    })
              }
              icon={query.group === "status" ? <TaskStatusIcon status={group.key as Task["status"]} className="size-3.5" /> : query.group === "priority" ? <PriorityIcon priority={group.key as Task["priority"]} className="size-3.5" /> : null}
              count={group.tasks.length}
              span={columns.length + 1}
            >
              {group.tasks.map((task, index) => (
                <RollRow key={task.id} index={index}>
                  <tr className="group/tr" data-open={openTaskId === task.id || undefined}>
                    <td className={cn(TD, "sticky left-0 z-[2] pl-6", openTaskId === task.id && TINT_OPEN)}>
                      <button type="button" onClick={() => onOpenTask(task.id)} className="press-text flex w-full min-w-0 items-center gap-2 text-left">
                        <TaskStatusIcon status={task.status} className="size-3.5" />
                        <span className={cn("truncate font-medium", task.status === "done" && "text-muted-foreground line-through decoration-1")}>
                          <RollInText text={task.title} />
                        </span>
                        <span className="text-muted-foreground ml-auto shrink-0 font-mono text-2xs">{dir.keyOf(task)}</span>
                      </button>
                    </td>
                    {columns.map((c) => (
                      <td key={c.key} className={cn(TD, openTaskId === task.id && TINT_OPEN)}>
                        <SpringSpan dependency={layoutKey} className="block min-w-0">
                          {cell(task, c.key)}
                        </SpringSpan>
                      </td>
                    ))}
                  </tr>
                </RollRow>
              ))}
            </GroupRows>
          ))}
          {editable && <NewTaskRow span={columns.length + 1} projectId={projectId ?? dir.projects.find((p) => p.status !== "completed")?.id} preset={groupPatch(query.group, groups[0]?.key ?? "", dir.today)} />}
        </tbody>
      </table>
      {mutations.confirmDeleteModal}
    </div>
  );
}

function GroupRows({
  title,
  icon,
  count,
  span,
  children,
}: {
  title: string | null;
  icon: ReactNode;
  count: number;
  span: number;
  children: ReactNode;
}) {
  return (
    <>
      {title !== null && (
        <tr>
          {/* The cell spans the whole sheet, so a sticky cell would scroll with
              it; the label is what stays put. */}
          <td colSpan={span} className="bg-alpha-light border-alpha-medium text-muted-foreground h-8 border-b pl-6 text-xs font-semibold">
            <span className="sticky left-6 inline-flex items-center gap-1.5">
              {icon}
              {title}
              <RollingNumber value={count} className="font-medium opacity-70" />
            </span>
          </td>
        </tr>
      )}
      {children}
    </>
  );
}

function NewTaskRow({
  span,
  projectId,
  preset,
}: {
  span: number;
  projectId: string | undefined;
  preset: Partial<Pick<Task, "status" | "priority" | "assigneeMemberId" | "projectId" | "dueDate">>;
}) {
  const [composing, setComposing] = useState(false);
  if (!projectId) return null;
  return (
    <tr>
      <td colSpan={span} className="bg-content border-alpha-medium text-muted-foreground sticky left-0 h-9 border-b pl-6 text-sm">
        {composing ? (
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              const input = event.currentTarget.elements.namedItem("title") as HTMLInputElement;
              const value = input.value.trim();
              if (!value) return setComposing(false);
              const { projectId: groupProject, ...rest } = preset;
              const result = await createTaskAction({ projectId: groupProject ?? projectId, title: value, ...rest });
              if (!result.ok) return toast.error(result.error);
              input.value = "";
            }}
          >
            <Input name="title" autoFocus placeholder="Task name, then Enter" aria-label="New task name" className="h-7 max-w-96 text-sm" onKeyDown={(e) => e.key === "Escape" && setComposing(false)} />
          </form>
        ) : (
          <button type="button" className="press-text hover:text-foreground inline-flex items-center gap-1.5" onClick={() => setComposing(true)}>
            <Plus className="size-3.5" /> New task
          </button>
        )}
      </td>
    </tr>
  );
}

function EstimateCell({ task, editable, onCommit }: { task: Task; editable: boolean; onCommit: (minutes: number | null) => void }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <input
        autoFocus
        defaultValue={task.estimateMinutes ? formatEstimate(task.estimateMinutes) : ""}
        placeholder="e.g. 2d"
        aria-label="Estimate"
        className="ring-ring -mx-2.5 h-9 w-[calc(100%+1.25rem)] bg-transparent px-2.5 text-sm outline-none ring-2 ring-inset"
        onBlur={(event) => {
          setEditing(false);
          const text = event.currentTarget.value;
          const minutes = text.trim() ? parseEstimate(text) : null;
          if (text.trim() && minutes === null) return toast.error("Write an estimate like 30m, 2h or 1d 4h.");
          if (minutes !== task.estimateMinutes) onCommit(minutes);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") setEditing(false);
        }}
      />
    );
  }
  return (
    <button
      type="button"
      disabled={!editable}
      onClick={() => setEditing(true)}
      className={cn("press-text w-full text-left tabular-nums disabled:cursor-default", !task.estimateMinutes && "text-muted-foreground")}
    >
      <RollInText text={task.estimateMinutes ? formatEstimate(task.estimateMinutes) : "—"} />
    </button>
  );
}

/** A header's right edge, dragged to set the column's width: live while dragging, stored on release. */
function ResizeEdge({
  start,
  onDraft,
  onCommit,
}: {
  start: number;
  onDraft: (width: number) => void;
  onCommit: (width: number) => void;
}) {
  // The grab is a delta from where the drag began, so the edge never jumps to the pointer.
  const origin = useRef<{ x: number; width: number; last: number } | null>(null);
  const [active, setActive] = useState(false);
  const begin = (event: PointerEvent<HTMLSpanElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    origin.current = { x: event.clientX, width: start, last: start };
    setActive(true);
  };
  const end = () => {
    const drag = origin.current;
    origin.current = null;
    setActive(false);
    if (drag && drag.last !== drag.width) onCommit(drag.last);
  };
  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize column"
      onPointerDown={begin}
      onPointerMove={(event) => {
        const drag = origin.current;
        if (!drag) return;
        drag.last = Math.max(MIN_TABLE_COLUMN_WIDTH, drag.width + event.clientX - drag.x);
        onDraft(drag.last);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      data-active={active || undefined}
      className="hover:bg-ring/40 data-[active]:bg-ring/40 absolute top-0 -right-[3px] bottom-0 z-[4] w-1.5 cursor-col-resize"
    />
  );
}
