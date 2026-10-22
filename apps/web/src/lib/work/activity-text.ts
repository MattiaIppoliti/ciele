import type { TaskPriority, TaskRecurrence, TaskStatus, WorkActivity } from "@agent-hub/core";
import {
  TASK_PRIORITY_LABELS,
  TASK_RECURRENCE_LABELS,
  TASK_STATUS_LABELS,
  addDays,
  formatEstimate,
} from "@agent-hub/core";
import { PROJECT_STATUS_LABELS, formatWorkDay } from "./work-format";

/**
 * What a Work Activity entry says (#1051), as the drawer and the Project's
 * Activity tab print it: "moved WEB-12 from To do to In review". Pure, so each
 * verb's sentence is tested and a new verb cannot ship without one (the switch
 * is exhaustive over core's closed union).
 */

export interface ActivityNames {
  person(id: string | null): string | null;
  label(id: string): string | null;
  /** A Teammate's name, when the viewer can see it. */
  teammate?(id: string): string | null;
  today: string;
}

const str = (value: unknown): string | null => (typeof value === "string" && value ? value : null);

export function activityText(entry: WorkActivity, names: ActivityNames, { withTask = true } = {}): string {
  const data = entry.data;
  const task = withTask ? (str(data.taskKey) ?? "a task") : "this task";
  const from = data.from;
  const to = data.to;
  const day = (value: unknown) => (str(value) ? formatWorkDay(value as string, names.today) : "no date");
  switch (entry.verb) {
    case "task.created":
      return withTask ? `created ${task}${str(data.taskTitle) ? ` “${data.taskTitle}”` : ""}` : "created this task";
    case "task.completed":
      return `completed ${task}`;
    case "task.reopened":
      return `reopened ${task}`;
    case "task.status":
      return `moved ${task} from ${TASK_STATUS_LABELS[from as TaskStatus] ?? from} to ${TASK_STATUS_LABELS[to as TaskStatus] ?? to}`;
    case "task.assigned": {
      const who = names.person(str(to));
      return who ? `assigned ${task} to ${who}` : `unassigned ${task}`;
    }
    case "task.priority":
      return `changed the priority of ${task} to ${TASK_PRIORITY_LABELS[to as TaskPriority] ?? to}`;
    case "task.due":
      return `changed the due date of ${task} to ${day(to)}`;
    case "task.start":
      return `changed the start date of ${task} to ${day(to)}`;
    case "task.estimate":
      return to ? `estimated ${task} at ${formatEstimate(Number(to))}` : `cleared the estimate of ${task}`;
    case "task.labels": {
      const labels = Array.isArray(data.labelIds) ? data.labelIds.map((id) => names.label(id)).filter(Boolean) : [];
      return labels.length ? `labelled ${task} ${labels.join(", ")}` : `removed the labels of ${task}`;
    }
    case "task.dependencies":
      return `updated what ${task} is blocked by`;
    case "task.recurrence":
      return to ? `set ${task} to repeat ${TASK_RECURRENCE_LABELS[to as TaskRecurrence]?.toLowerCase() ?? to}` : `stopped ${task} repeating`;
    case "task.renamed":
      return `renamed ${task} to “${to}”`;
    case "task.description":
      return `edited the description of ${task}`;
    case "task.moved":
      return `moved ${task} to ${str(data.toProject) ?? "another project"}${str(data.newKey) ? ` as ${data.newKey}` : ""}`;
    case "task.improvement":
      return to ? `linked ${task} to an Improvement` : `unlinked ${task} from its Improvement`;
    case "improvement.review":
      // The Task's completion or deletion handed its Improvement to review (ADR-0027).
      return `moved ${str(data.improvementKey) ?? "its Improvement"} to In review`;
    case "task.archived":
      return `archived ${task}`;
    case "task.restored":
      return `restored ${task}`;
    case "task.deleted":
      return `deleted ${task}${str(data.taskTitle) ? ` “${data.taskTitle}”` : ""}`;
    case "subtask.added":
      return `added a subtask to ${task}`;
    case "subtask.converted":
      return `made ${task} a task of its own`;
    case "file.added":
      return `added a file to ${task}`;
    case "file.removed":
      return `removed a file from ${task}`;
    case "comment.added":
      return `commented on ${task}`;
    case "project.created":
      return str(data.duplicateOf) ? `created this project from ${data.duplicateOf}` : "created this project";
    case "project.updated":
      return "edited the project";
    case "project.status":
      return `changed the project status to ${PROJECT_STATUS_LABELS[to as keyof typeof PROJECT_STATUS_LABELS] ?? to}`;
    case "project.milestones":
      return "updated the milestones";
    case "project.members":
      return "changed who is on the project";
    case "project.archived":
      return "archived the project";
    case "project.restored":
      return "restored the project";
  }
}

/**
 * Who did it: the Member, or "Teammate for Member" when a Teammate acted
 * (#1051, #1069). A Teammate the viewer cannot see stays "A Teammate".
 */
export function activityActor(entry: WorkActivity, names: ActivityNames): string {
  const member = names.person(entry.actorMemberId) ?? null;
  if (entry.actorTeammateId) {
    const teammate = names.teammate?.(entry.actorTeammateId) ?? "A Teammate";
    return member ? `${teammate} for ${member}` : teammate;
  }
  return member ?? "Someone";
}

/** A comment's excerpt, carried on its activity entry so the list needs no comment read. */
export function activityExcerpt(entry: WorkActivity): string | null {
  return entry.verb === "comment.added" ? str(entry.data.excerpt) : null;
}

/**
 * Work Activity grouped by the day it happened, newest first, each day headed
 * "Today", "Yesterday" or its date. Days are UTC, like every work date.
 */
export function groupActivityByDay(entries: readonly WorkActivity[], today: string): { day: string; title: string; entries: WorkActivity[] }[] {
  const groups = new Map<string, WorkActivity[]>();
  for (const item of [...entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    const day = item.createdAt.slice(0, 10);
    groups.set(day, [...(groups.get(day) ?? []), item]);
  }
  const yesterday = addDays(today, -1);
  const title = (day: string) => (day === today ? "Today" : day === yesterday ? "Yesterday" : formatWorkDay(day, today));
  return [...groups].map(([day, items]) => ({ day, title: title(day), entries: items }));
}
