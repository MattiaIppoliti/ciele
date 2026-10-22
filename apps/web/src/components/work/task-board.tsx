"use client";

import { useMemo, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { motion, useReducedMotion } from "motion/react";
import { CheckCheck, ChevronsLeftRight, Ellipsis, ListOrdered, Plus, Repeat } from "lucide-react";
import { Button, Input } from "@agent-hub/ui";
import type { Task, TaskLabelLink, TaskStatus, WorkViewQuery } from "@agent-hub/core";
import {
  TASK_PRIORITY_WEIGHT,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  matchesWorkQuery,
  taskProgress,
} from "@agent-hub/core";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RollInText, RollRow } from "@/components/motion/roll-in-text";
import { RollingNumber } from "@/components/motion/rolling-number";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { SPRING_SWAP } from "@/lib/ease";
import { dueLabel } from "@/lib/work/work-format";
import { dropPosition, isNoOpDrop, stepPosition } from "@/lib/work/drop-position";
import { useAutoScroll, useDraggableTask, useTaskDropTarget } from "@/lib/drag/drag-adapter";
import { createTaskAction } from "@/app/work-actions";
import { PriorityIcon, ProjectGlyph, TaskStatusIcon } from "./work-icons";
import { AssigneePicker, DatePickerPopover, PriorityPicker, StatusPicker } from "./task-pickers";
import { useTaskMutations } from "./use-task-mutations";
import { useWorkDirectory } from "./work-directory";
import { useWorkViewContext } from "./use-work-view-context";
import { useCollapsedGroups } from "./use-collapsed-groups";
import { LabelChip, WorkAvatar } from "./work-ui";

/**
 * The Board layout (#1064): five status columns, cards in their manual order,
 * dragged between columns (status) and within one (order). The keyboard does
 * both: a card's status picker moves it to another column, and Alt+Up/Down on
 * a focused card moves it within its own. The column menu adds, collapses,
 * marks all done or archives the done ones, and sorts by priority. 284px
 * sunken columns, raised cards, the column's own actions shown on hover and an
 * "Add task" row at its foot.
 */
export function TaskBoard({
  tasks,
  labelLinks,
  query,
  scope,
  projectId,
  onOpenTask,
  openTaskId,
}: {
  tasks: Task[];
  labelLinks: TaskLabelLink[];
  query: WorkViewQuery;
  scope: "project" | "all-tasks";
  projectId?: string;
  onOpenTask: (id: string) => void;
  openTaskId: string | null;
}) {
  const dir = useWorkDirectory();
  const mutations = useTaskMutations(tasks);
  const folded = useCollapsedGroups(`work.${scope}.board.collapsed`);
  const scroller = useRef<HTMLDivElement>(null);
  useAutoScroll(scroller);

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
  const columns = useMemo(() => {
    const visible = mutations.tasks
      .filter((task) => !task.parentId && matchesWorkQuery(task, query, ctx))
      .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0));
    return TASK_STATUSES.map((status) => ({ status, tasks: visible.filter((task) => task.status === status) }));
  }, [mutations.tasks, query, ctx]);

  const drop = (status: TaskStatus, ordered: Task[]) => (taskId: string, targetId: string | null, edge: "top" | "bottom" | null) => {
    const task = mutations.tasks.find((t) => t.id === taskId);
    if (!task) return;
    const ids = ordered.map((t) => t.id);
    const position = dropPosition(ids, taskId, targetId, edge);
    if (task.status === status && isNoOpDrop(ids, taskId, position)) return;
    mutations.move(task, task.status === status ? {} : { status }, position);
    // A completion says so itself, with its Undo.
    if (task.status !== status && status !== "done") toast.success(`Moved ${dir.keyOf(task)} to ${TASK_STATUS_LABELS[status]}`);
  };

  return (
    <div ref={scroller} className="flex h-full min-h-0 items-start gap-3 overflow-x-auto px-6 pt-3.5 pb-6" role="list" aria-label="Board">
      {columns.map(({ status, tasks: cards }) =>
        folded.isCollapsed(status) ? (
          <button
            key={status}
            type="button"
            role="listitem"
            onClick={() => folded.setCollapsed(status, false)}
            className="press bg-alpha-lighter border-alpha-medium hover:bg-alpha-light flex w-11 shrink-0 flex-col items-center gap-2 self-stretch rounded-xl border pt-2"
            aria-label={`Expand ${TASK_STATUS_LABELS[status]}`}
          >
            <TaskStatusIcon status={status} />
            <RollingNumber value={cards.length} className="text-muted-foreground text-xs" />
            <span className="text-muted-foreground text-sm font-medium [writing-mode:vertical-rl]">{TASK_STATUS_LABELS[status]}</span>
          </button>
        ) : (
          <BoardColumn
            key={status}
            status={status}
            cards={cards}
            scope={scope}
            projectId={projectId}
            labelsOf={labelsOf}
            subtasksOf={subtasksOf}
            openTaskId={openTaskId}
            onOpenTask={onOpenTask}
            onDrop={drop(status, cards)}
            onCollapse={() => folded.setCollapsed(status, true)}
            mutations={mutations}
          />
        )
      )}
      {mutations.confirmDeleteModal}
    </div>
  );
}

type Mutations = ReturnType<typeof useTaskMutations>;

function BoardColumn({
  status,
  cards,
  scope,
  projectId,
  labelsOf,
  subtasksOf,
  openTaskId,
  onOpenTask,
  onDrop,
  onCollapse,
  mutations,
}: {
  status: TaskStatus;
  cards: Task[];
  scope: "project" | "all-tasks";
  projectId?: string;
  labelsOf: (id: string) => string[];
  subtasksOf: Map<string, Task[]>;
  openTaskId: string | null;
  onOpenTask: (id: string) => void;
  onDrop: (taskId: string, targetId: string | null, edge: "top" | "bottom" | null) => void;
  onCollapse: () => void;
  mutations: Mutations;
}) {
  const dir = useWorkDirectory();
  const ref = useRef<HTMLDivElement>(null);
  const [, startTransition] = useTransition();
  const [composing, setComposing] = useState(false);
  const target = useTaskDropTarget(ref, { data: { kind: "column", status }, disabled: !dir.canEdit, onDrop: (id) => onDrop(id, null, null) });
  const composeProject = projectId ?? dir.projects.find((p) => p.status !== "completed")?.id;

  // The drop's keyboard path within the column: one place up or down.
  const step = (task: Task, direction: -1 | 1) => {
    const position = stepPosition(
      cards.map((c) => c.id),
      task.id,
      direction
    );
    if (position) mutations.move(task, {}, position);
  };

  return (
    <section
      ref={ref}
      role="listitem"
      aria-label={`${TASK_STATUS_LABELS[status]}, ${cards.length} tasks`}
      data-over={target.over || undefined}
      className="group/col bg-alpha-lighter border-alpha-medium data-[over]:border-ring/50 data-[over]:bg-alpha-light flex max-h-full w-71 shrink-0 flex-col rounded-xl border transition-colors"
    >
      <header className="flex h-10 shrink-0 items-center gap-1.75 pt-1 pr-2 pl-3 text-sm font-semibold">
        <TaskStatusIcon status={status} className="size-3.5" />
        <h3>{TASK_STATUS_LABELS[status]}</h3>
        <RollingNumber value={cards.length} className="text-muted-foreground font-medium" />
        <div className="ml-auto flex items-center opacity-0 transition-opacity group-hover/col:opacity-100 [@media(hover:none)]:opacity-100 focus-within:opacity-100 has-[[data-popup-open]]:opacity-100">
          {dir.canEdit && composeProject && (
            <Button size="icon-sm" variant="ghost" aria-label={`Add task to ${TASK_STATUS_LABELS[status]}`} onClick={() => setComposing(true)}>
              <Plus className="size-4" />
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" aria-label={`${TASK_STATUS_LABELS[status]} column menu`} />}>
              <Ellipsis className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {dir.canEdit && composeProject && (
                <DropdownMenuItem onClick={() => setComposing(true)}>
                  <Plus className="size-4" /> Add task
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={onCollapse}>
                <ChevronsLeftRight className="size-4" /> Collapse column
              </DropdownMenuItem>
              {dir.canEdit && status !== "done" && (
                <DropdownMenuItem onClick={() => mutations.bulk(cards.map((c) => c.id), { status: "done" })}>
                  <CheckCheck className="size-4" /> Mark all as done
                </DropdownMenuItem>
              )}
              {dir.canEdit && status === "done" && (
                <DropdownMenuItem onClick={() => mutations.archive(cards.map((c) => c.id))}>
                  <CheckCheck className="size-4" /> Archive completed
                </DropdownMenuItem>
              )}
              {dir.canEdit && cards.length > 1 && (
                <DropdownMenuItem
                  // Rewrite the manual order by priority, most urgent first.
                  onClick={() =>
                    mutations.reorder([...cards].sort((a, b) => TASK_PRIORITY_WEIGHT[b.priority] - TASK_PRIORITY_WEIGHT[a.priority]))
                  }
                >
                  <ListOrdered className="size-4" /> Sort by priority
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <ol className="flex min-h-15 flex-col gap-1.5 overflow-y-auto px-2 pt-1 pb-2">
        {cards.map((task, index) => (
          <RollRow key={task.id} index={index}>
            <BoardCard
              task={task}
              scope={scope}
              labelIds={labelsOf(task.id)}
              subtasks={subtasksOf.get(task.id) ?? []}
              open={openTaskId === task.id}
              onOpen={() => onOpenTask(task.id)}
              onDropOnCard={(id, edge) => onDrop(id, task.id, edge)}
              onStep={(direction) => step(task, direction)}
              mutations={mutations}
            />
          </RollRow>
        ))}
      </ol>
      {composing && composeProject && (
        <form
          className="px-2 pb-2"
          onSubmit={(event) => {
            event.preventDefault();
            const input = event.currentTarget.elements.namedItem("title") as HTMLInputElement;
            const title = input.value.trim();
            if (!title) return setComposing(false);
            startTransition(async () => {
              const result = await createTaskAction({ projectId: composeProject, title, status });
              if (!result.ok) return toast.error(result.error);
              input.value = "";
            });
          }}
        >
          <Input
            name="title"
            autoFocus
            placeholder="Task name, then Enter"
            aria-label={`New task in ${TASK_STATUS_LABELS[status]}`}
            className="bg-content h-9"
            onKeyDown={(event) => event.key === "Escape" && setComposing(false)}
            onBlur={(event) => !event.currentTarget.value.trim() && setComposing(false)}
          />
        </form>
      )}
      {!composing && dir.canEdit && composeProject && (
        <div className="px-2 pb-2">
          <button
            type="button"
            onClick={() => setComposing(true)}
            className="press-control text-muted-foreground hover:bg-alpha-light hover:text-foreground flex h-7.5 w-full items-center gap-1.5 rounded-md px-2 text-sm"
          >
            <Plus className="size-3.5" /> Add task
          </button>
        </div>
      )}
    </section>
  );
}

function BoardCard({
  task,
  scope,
  labelIds,
  subtasks,
  open,
  onOpen,
  onDropOnCard,
  onStep,
  mutations,
}: {
  task: Task;
  scope: "project" | "all-tasks";
  labelIds: string[];
  subtasks: Task[];
  open: boolean;
  onOpen: () => void;
  onDropOnCard: (taskId: string, edge: "top" | "bottom" | null) => void;
  /** One place up or down the column, from the keyboard. */
  onStep: (direction: -1 | 1) => void;
  mutations: Mutations;
}) {
  const dir = useWorkDirectory();
  const ref = useRef<HTMLLIElement>(null);
  const reduceMotion = useReducedMotion();
  const dragging = useDraggableTask(ref, task.id, { disabled: !dir.canEdit });
  const target = useTaskDropTarget(ref, { data: { kind: "card", taskId: task.id }, edges: true, disabled: !dir.canEdit, onDrop: onDropOnCard });
  const assignee = dir.person(task.assigneeMemberId);
  const project = dir.project(task.projectId);
  const due = task.dueDate ? dueLabel(task.dueDate, dir.today, task.status) : null;
  const done = subtasks.filter((s) => s.status === "done").length;

  // Alt+Up/Down from anywhere on the card. A picker's popover is portalled out
  // of the card, so keys typed in it never move the card.
  const onKeyDown = (event: KeyboardEvent<HTMLLIElement>) => {
    if (!dir.canEdit || !event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    if (!event.currentTarget.contains(event.target as Node)) return;
    event.preventDefault();
    onStep(event.key === "ArrowUp" ? -1 : 1);
  };

  return (
    <motion.li
      ref={ref}
      layout={!reduceMotion}
      transition={SPRING_SWAP}
      onKeyDown={onKeyDown}
      data-open={open || undefined}
      data-dragging={dragging || undefined}
      className={cn(
        "bg-content border-alpha-medium data-[open]:border-ring/60 shadow-light hover:shadow-strong relative flex cursor-grab flex-col gap-2 rounded-lg border px-3 py-2.5 text-sm transition-shadow data-[dragging]:opacity-40",
        task.status === "done" && "text-muted-foreground"
      )}
    >
      {target.edge && (
        <span aria-hidden className={cn("bg-ring absolute inset-x-1 h-0.5 rounded-full", target.edge === "top" ? "-top-1" : "-bottom-1")} />
      )}
      {labelIds.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {labelIds.slice(0, 3).map((id) => {
            const label = dir.label(id);
            return label ? (
              <LabelChip key={id} name={label.name} color={label.color} />
            ) : null;
          })}
        </div>
      )}
      <div className="flex items-start gap-2">
        <StatusPicker
          value={task.status}
          disabled={!dir.canEdit}
          onChange={(status) => mutations.update(task, { status })}
          trigger={
            <button type="button" className="press-control mt-0.5 rounded-full" aria-label={`Status: ${TASK_STATUS_LABELS[task.status]}. Move to…`}>
              <TaskStatusIcon status={task.status} />
            </button>
          }
        />
        <button
          type="button"
          onClick={onOpen}
          aria-keyshortcuts={dir.canEdit ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
          className={cn("press-text min-w-0 flex-1 text-left leading-snug", task.status === "done" && "line-through decoration-1")}
        >
          <RollInText text={task.title} />
        </button>
      </div>
      {subtasks.length > 0 && (
        <div className="flex items-center gap-2" aria-label={`${done} of ${subtasks.length} subtasks done`}>
          <span className="bg-alpha-medium h-1 flex-1 overflow-hidden rounded-full">
            <span className="bg-tone-green-ink block h-full rounded-full" style={{ width: `${taskProgress(task, subtasks)}%` }} />
          </span>
          <span className="text-muted-foreground text-xs tabular-nums">
            <RollInText text={`${done}/${subtasks.length}`} />
          </span>
        </div>
      )}
      <div className="text-muted-foreground flex items-center gap-2.5 text-xs">
        {scope === "all-tasks" && project && <ProjectGlyph icon={project.icon} color={project.color} className="size-3.5" />}
        <span className="font-mono text-2xs">{dir.keyOf(task)}</span>
        <PriorityPicker
          value={task.priority}
          disabled={!dir.canEdit}
          onChange={(priority) => mutations.update(task, { priority })}
          trigger={
            <button type="button" className="press-control rounded p-0.5" aria-label={`Priority: ${task.priority}`}>
              <PriorityIcon priority={task.priority} className="size-3.5" />
            </button>
          }
        />
        {task.recurrence && <Repeat aria-label="Repeats" className="size-3.5" />}
        <DatePickerPopover
          label="Due date"
          value={task.dueDate}
          disabled={!dir.canEdit}
          onChange={(dueDate) => mutations.update(task, { dueDate })}
          trigger={
            <button
              type="button"
              className={cn("press-control rounded px-1", due?.tone === "overdue" && "text-destructive", due?.tone === "today" && "text-tone-amber-ink")}
              aria-label={due ? `Due ${due.text}` : "Set due date"}
            >
              {due ? due.text : ""}
            </button>
          }
        />
        <span className="ml-auto flex items-center gap-1">
          <AssigneePicker
            value={task.assigneeMemberId}
            disabled={!dir.canEdit}
            onChange={(assigneeMemberId) => mutations.update(task, { assigneeMemberId })}
            align="end"
            trigger={
              <button type="button" className="press-control rounded-full" aria-label={assignee ? `Assigned to ${assignee.name}` : "Unassigned"}>
                <WorkAvatar person={assignee} size="sm" />
              </button>
            }
          />
        </span>
      </div>
    </motion.li>
  );
}
