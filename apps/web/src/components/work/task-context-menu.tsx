"use client";

import { createContext, useContext, useState, type ReactElement, type ReactNode } from "react";
import type { Task, TaskPriority, TaskStatus } from "@agent-hub/core";
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  addDays,
} from "@agent-hub/core";
import { Archive, PanelRight, Trash2 } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/motion/context-menu";
import { UserAvatar } from "@/components/ui/user-avatar";
import { PriorityIcon, TaskStatusIcon } from "./work-icons";
import { useWorkDirectory } from "./work-directory";

/** The fields a right-click can change; the same patch the pickers send. */
export type TaskMenuPatch = Partial<Pick<Task, "status" | "priority" | "assigneeMemberId" | "dueDate">>;

/** People listed before the rest are left to the Assignee picker's search. */
const LISTED_PEOPLE = 5;

const DUE_PRESETS: Array<{ label: string; days: number | null }> = [
  { label: "Today", days: 0 },
  { label: "Tomorrow", days: 1 },
  { label: "In a week", days: 7 },
  { label: "No date", days: null },
];

/**
 * Right-click (or long-press / Shift+F10) on a Task, in every layout that
 * shows one: List, Board, Table, Calendar and Timeline. The Improvements
 * board's menu shape, with a Task's fields: what the row's pickers change,
 * under the pointer wherever the Task is drawn.
 *
 * Each layout passes its own `update`, so the change rides that layout's
 * optimistic state and refusal toast rather than a second write path.
 */
export function TaskContextMenu({
  task,
  canEdit = true,
  onUpdate,
  onOpen,
  onArchive,
  onDelete,
  children,
}: {
  task: Task;
  canEdit?: boolean;
  onUpdate: (patch: TaskMenuPatch) => void;
  onOpen?: () => void;
  onArchive?: () => void;
  onDelete?: () => void;
  children: ReactElement<React.HTMLAttributes<HTMLElement>>;
}) {
  const dir = useWorkDirectory();
  // The menu component keeps its content mounted while closed, and a Task
  // menu is some twenty-five rows: across a long list (two per Task on the
  // Timeline) that is thousands of idle nodes. They mount on the first open,
  // in the same update the menu measures itself in, and stay for the exit.
  const [armed, setArmed] = useState(false);
  const people = dir.people
    .filter((person) => person.assignable)
    .sort((a, b) =>
      a.userId === task.assigneeMemberId ? -1 : b.userId === task.assigneeMemberId ? 1
        : a.userId === dir.viewerId ? -1 : b.userId === dir.viewerId ? 1 : a.name.localeCompare(b.name))
    .slice(0, LISTED_PEOPLE);
  const today = dir.today;
  const dueValue = DUE_PRESETS.find((preset) =>
    preset.days === null ? task.dueDate === null : task.dueDate === addDays(today, preset.days))?.label ?? "";

  return (
    <ContextMenu onOpenChange={(open) => open && setArmed(true)}>
      <ContextMenuTrigger>{children}</ContextMenuTrigger>
      <ContextMenuContent className="no-scrollbar max-h-[calc(100dvh-1.5rem)] w-60 overflow-y-auto">
        <ContextMenuLabel>{`${dir.keyOf(task)} · ${task.title}`}</ContextMenuLabel>
        {armed && <>
        {onOpen && <ContextMenuItem textValue="Open" onSelect={onOpen}><PanelRight className="size-4 shrink-0" />Open</ContextMenuItem>}
        {canEdit && <>
          <ContextMenuSeparator />
          <ContextMenuLabel>Status</ContextMenuLabel>
          <ContextMenuRadioGroup value={task.status} onValueChange={(value) => value !== task.status && onUpdate({ status: value as TaskStatus })}>
            {TASK_STATUSES.map((status) => (
              <ContextMenuRadioItem key={status} value={status} textValue={TASK_STATUS_LABELS[status]}>
                <TaskStatusIcon status={status} />{TASK_STATUS_LABELS[status]}
              </ContextMenuRadioItem>
            ))}
          </ContextMenuRadioGroup>
          <ContextMenuSeparator />
          <ContextMenuLabel>Priority</ContextMenuLabel>
          <ContextMenuRadioGroup value={task.priority} onValueChange={(value) => value !== task.priority && onUpdate({ priority: value as TaskPriority })}>
            {TASK_PRIORITIES.map((priority) => (
              <ContextMenuRadioItem key={priority} value={priority} textValue={TASK_PRIORITY_LABELS[priority]}>
                <PriorityIcon priority={priority} />{TASK_PRIORITY_LABELS[priority]}
              </ContextMenuRadioItem>
            ))}
          </ContextMenuRadioGroup>
          <ContextMenuSeparator />
          <ContextMenuLabel>Assignee</ContextMenuLabel>
          <ContextMenuRadioGroup value={task.assigneeMemberId ?? ""} onValueChange={(value) => {
            const next = value || null;
            if (next !== task.assigneeMemberId) onUpdate({ assigneeMemberId: next });
          }}>
            <ContextMenuRadioItem value="" textValue="Unassigned">
              <span className="border-alpha-strong size-4 rounded-full border border-dashed" aria-hidden />Unassigned
            </ContextMenuRadioItem>
            {people.map((person) => (
              <ContextMenuRadioItem key={person.userId} value={person.userId} textValue={person.name}>
                <UserAvatar userId={person.userId} email={person.email} avatarUrl={person.avatarUrl} size="size-4" />
                <span className="min-w-0 truncate">{person.name}{person.userId === dir.viewerId ? " (you)" : ""}</span>
              </ContextMenuRadioItem>
            ))}
          </ContextMenuRadioGroup>
          <ContextMenuSeparator />
          <ContextMenuLabel>Due date</ContextMenuLabel>
          <ContextMenuRadioGroup value={dueValue} onValueChange={(label) => {
            const preset = DUE_PRESETS.find((p) => p.label === label);
            if (!preset) return;
            const next = preset.days === null ? null : addDays(today, preset.days);
            if (next !== task.dueDate) onUpdate({ dueDate: next });
          }}>
            {DUE_PRESETS.map((preset) => (
              <ContextMenuRadioItem key={preset.label} value={preset.label} textValue={preset.label}>{preset.label}</ContextMenuRadioItem>
            ))}
          </ContextMenuRadioGroup>
          {(onArchive || onDelete) && <ContextMenuSeparator />}
          {onArchive && <ContextMenuItem textValue="Archive" onSelect={onArchive}><Archive className="size-4 shrink-0" />Archive</ContextMenuItem>}
          {onDelete && <ContextMenuItem tone="destructive" textValue="Delete" onSelect={onDelete}><Trash2 className="size-4 shrink-0" />Delete</ContextMenuItem>}
        </>}
        </>}
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** A layout's own write path, for chips and bars drawn a few components down. */
export interface TaskMenuActions {
  canEdit: boolean;
  update: (task: Task, patch: TaskMenuPatch) => void;
  open: (taskId: string) => void;
  archive: (taskId: string) => void;
  remove: (taskId: string) => void;
}

const TaskMenuActionsContext = createContext<TaskMenuActions | null>(null);

export const TaskMenuProvider = TaskMenuActionsContext.Provider;

/**
 * The menu around a Task drawn inside a `TaskMenuProvider`. The wrapper is
 * `display: contents`, so it takes the right-click without moving the chip.
 */
export function TaskMenuFor({ task, children }: { task: Task; children: ReactNode }) {
  const actions = useContext(TaskMenuActionsContext);
  if (!actions) return <>{children}</>;
  return (
    <TaskContextMenu
      task={task}
      canEdit={actions.canEdit}
      onUpdate={(patch) => actions.update(task, patch)}
      onOpen={() => actions.open(task.id)}
      onArchive={() => actions.archive(task.id)}
      onDelete={() => actions.remove(task.id)}
    >
      <div className="contents">{children}</div>
    </TaskContextMenu>
  );
}
