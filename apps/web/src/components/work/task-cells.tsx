"use client";

import type { Task } from "@agent-hub/core";
import { TASK_PRIORITY_LABELS, TASK_STATUS_LABELS } from "@agent-hub/core";
import { RollInText } from "@/components/motion/roll-in-text";
import { cn } from "@/lib/utils";
import { dueLabel, formatWorkDay } from "@/lib/work/work-format";
import type { updateTaskAction } from "@/app/work-actions";
import { PriorityIcon, ProjectGlyph, TaskStatusIcon } from "./work-icons";
import { AssigneePicker, DatePickerPopover, LabelsPicker, PriorityPicker, StatusPicker } from "./task-pickers";
import { useWorkDirectory } from "./work-directory";
import { LabelChip, PillButton, WorkAvatar } from "./work-ui";

/**
 * One property of a Task as a row shows it (#1063, #1064): the value in a
 * `PillButton` that opens its picker. The List and the Table draw the same
 * cells; the List's are denser, hide an empty date or label set until the row
 * is hovered, and show at most two labels. Every value rolls when it changes.
 */

export type TaskPatch = NonNullable<Parameters<typeof updateTaskAction>[0]["patch"]>;

export type TaskCellKey = "status" | "priority" | "assignee" | "due" | "start" | "labels" | "project";

const LIST_LABELS = 2;

export function TaskCell({
  column,
  task,
  labelIds,
  editable,
  projectMemberIds,
  layout,
  onPatch,
  onLabels,
}: {
  column: TaskCellKey;
  task: Task;
  labelIds: readonly string[];
  editable: boolean;
  /** A private Project's members, to scope the assignee picker. */
  projectMemberIds?: readonly string[] | null;
  layout: "list" | "table";
  onPatch: (patch: TaskPatch) => void;
  onLabels: (labelIds: string[]) => void;
}) {
  const dir = useWorkDirectory();
  const list = layout === "list";
  const pill = cn("-ml-1.5", list && "text-xs");
  // An empty value in the List shows only on the row's hover or focus.
  const hiddenWhenEmpty = list && "opacity-0 group-hover/row:opacity-100 [@media(hover:none)]:opacity-100 focus-visible:opacity-100";

  switch (column) {
    case "status":
      return (
        <StatusPicker
          value={task.status}
          disabled={!editable}
          onChange={(status) => onPatch({ status })}
          trigger={
            <PillButton className={pill} aria-label={`Status: ${TASK_STATUS_LABELS[task.status]}`}>
              <TaskStatusIcon status={task.status} className="size-3.5" />
              <span className="truncate">
                <RollInText text={TASK_STATUS_LABELS[task.status]} />
              </span>
            </PillButton>
          }
        />
      );
    case "priority":
      return (
        <PriorityPicker
          value={task.priority}
          disabled={!editable}
          onChange={(priority) => onPatch({ priority })}
          trigger={
            <PillButton className={pill} muted={task.priority === "none"} aria-label={`Priority: ${TASK_PRIORITY_LABELS[task.priority]}`}>
              <PriorityIcon priority={task.priority} className="size-3.5" />
              <span className="truncate">
                <RollInText text={TASK_PRIORITY_LABELS[task.priority]} />
              </span>
            </PillButton>
          }
        />
      );
    case "assignee": {
      const person = dir.person(task.assigneeMemberId);
      return (
        <AssigneePicker
          value={task.assigneeMemberId}
          disabled={!editable}
          projectMemberIds={projectMemberIds}
          onChange={(assigneeMemberId) => onPatch({ assigneeMemberId })}
          trigger={
            <PillButton className={pill} muted={!person} aria-label={person ? `Assigned to ${person.name}` : "Unassigned"}>
              <WorkAvatar person={person} size="sm" />
              <span className="truncate">
                <RollInText text={person ? person.name : "Unassigned"} />
              </span>
            </PillButton>
          }
        />
      );
    }
    case "due":
    case "start": {
      const label = column === "due" ? "Due date" : "Start date";
      const day = column === "due" ? task.dueDate : task.startDate;
      // A due date reads relative to today and takes the urgency's ink.
      const due = column === "due" && day ? dueLabel(day, dir.today, task.status) : null;
      const text = day ? (due?.text ?? formatWorkDay(day, dir.today)) : null;
      return (
        <DatePickerPopover
          label={label}
          value={day}
          disabled={!editable}
          onChange={(next) => onPatch(column === "due" ? { dueDate: next } : { startDate: next })}
          trigger={
            <PillButton
              className={cn(
                pill,
                "tabular-nums",
                !text && hiddenWhenEmpty,
                due?.tone === "overdue" && "text-destructive",
                (due?.tone === "soon" || due?.tone === "today") && "text-tone-amber-ink"
              )}
              muted={!text || due?.tone === "done"}
              aria-label={text ? `${label}: ${text}` : `Set ${label.toLowerCase()}`}
            >
              {text ? <RollInText text={text} /> : list ? "Set date" : "—"}
            </PillButton>
          }
        />
      );
    }
    case "labels": {
      const shown = list ? labelIds.slice(0, LIST_LABELS) : labelIds;
      const names = labelIds.map((id) => dir.label(id)?.name).filter(Boolean);
      return (
        <LabelsPicker
          value={labelIds}
          disabled={!editable}
          onChange={onLabels}
          trigger={
            <PillButton
              className={cn(pill, "gap-1", !labelIds.length && hiddenWhenEmpty)}
              muted={!labelIds.length}
              aria-label={names.length ? `Labels: ${names.join(", ")}` : "Add labels"}
            >
              {labelIds.length ? (
                <>
                  {shown.map((id) => {
                    const item = dir.label(id);
                    return item ? <LabelChip key={id} name={item.name} color={item.color} /> : null;
                  })}
                  {labelIds.length > shown.length && <span className="text-muted-foreground text-2xs">+{labelIds.length - shown.length}</span>}
                </>
              ) : list ? (
                "Add label"
              ) : (
                "—"
              )}
            </PillButton>
          }
        />
      );
    }
    case "project": {
      const project = dir.project(task.projectId);
      return project ? (
        <span className={cn("inline-flex min-w-0 items-center gap-1.5", list && "text-muted-foreground text-xs")}>
          <ProjectGlyph icon={project.icon} color={project.color} className="size-3.5" />
          <span className="truncate">
            <RollInText text={project.name} />
          </span>
        </span>
      ) : null;
    }
  }
}
