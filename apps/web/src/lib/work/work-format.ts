import type { ImprovementStatus, ProjectStatus, TaskStatus, WorkGroupField, WorkViewQuery } from "@agent-hub/core";
import { TASK_PRIORITY_LABELS, TASK_STATUS_LABELS, UNASSIGNED, daysBetween, defaultWorkQuery } from "@agent-hub/core";

/**
 * The work section's display rules (#1063), pure so they are tested: how a
 * date reads, which tone a status takes, and what each view starts from.
 */

const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const DAY_YEAR = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** `12 Oct`, or `12 Oct 2027` outside the current year. */
export function formatWorkDay(day: string, today: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  return (day.slice(0, 4) === today.slice(0, 4) ? DAY : DAY_YEAR).format(date);
}

export type DueTone = "overdue" | "today" | "soon" | "later" | "done";

/** How a due date reads on a row: relative near today, a date otherwise. */
export function dueLabel(
  dueDate: string,
  today: string,
  status: TaskStatus = "to_do"
): { text: string; tone: DueTone } {
  const delta = daysBetween(today, dueDate);
  const tone: DueTone =
    status === "done" ? "done" : delta < 0 ? "overdue" : delta === 0 ? "today" : delta <= 3 ? "soon" : "later";
  if (delta === 0) return { text: "Today", tone };
  if (delta === 1) return { text: "Tomorrow", tone };
  if (delta === -1) return { text: "Yesterday", tone };
  return { text: formatWorkDay(dueDate, today), tone };
}

/** "Overdue by 3 days", for the drawer's banner. */
export function overdueText(dueDate: string, today: string): string {
  const days = daysBetween(dueDate, today);
  return `Overdue by ${days} day${days === 1 ? "" : "s"}`;
}

/** "3 days ago", for the completed banner and activity times. */
export function agoText(iso: string, now: Date = new Date()): string {
  const seconds = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return DAY_YEAR.format(new Date(iso));
}

export type Tone = "gray" | "blue" | "green" | "amber" | "red" | "purple";

/** Status → tag tone, on DESIGN.md §2.3's meanings. */
export const TASK_STATUS_TONE: Record<TaskStatus, Tone> = {
  backlog: "gray",
  to_do: "gray",
  in_progress: "amber",
  in_review: "purple",
  done: "green",
};

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  planning: "Planning",
  active: "In progress",
  at_risk: "At risk",
  on_hold: "On hold",
  completed: "Completed",
};

export const PROJECT_STATUS_TONE: Record<ProjectStatus, Tone> = {
  planning: "gray",
  active: "blue",
  at_risk: "red",
  on_hold: "amber",
  completed: "green",
};

/** An Improvement assigned to me, as My Tasks lists it (DESIGN.md §2.3). */
export const IMPROVEMENT_STATUS_TONE: Record<ImprovementStatus, Tone> = {
  to_do: "gray",
  in_progress: "blue",
  in_review: "amber",
  done: "green",
  archived: "gray",
};

/** The solid dot for a colour: the tone's ink (DESIGN.md §2.3, the dot exception). */
export const DOT_CLASS: Record<Tone, string> = {
  gray: "bg-tone-gray-ink",
  blue: "bg-tone-blue-ink",
  green: "bg-tone-green-ink",
  amber: "bg-tone-amber-ink",
  red: "bg-tone-red-ink",
  purple: "bg-tone-purple-ink",
};

export const INK_CLASS: Record<Tone, string> = {
  gray: "text-tone-gray-ink",
  blue: "text-tone-blue-ink",
  green: "text-tone-green-ink",
  amber: "text-tone-amber-ink",
  red: "text-tone-red-ink",
  purple: "text-tone-purple-ink",
};

/** What each scope's view starts from (#1050); the URL only stores departures from it. */
export type WorkScope = "project" | "my-tasks" | "all-tasks";

export function workViewDefaults(scope: WorkScope): WorkViewQuery {
  switch (scope) {
    case "project":
      return defaultWorkQuery({ group: "status", sort: { field: "manual", direction: "asc" } });
    case "my-tasks":
      return defaultWorkQuery({ group: "none", sort: { field: "due", direction: "asc" } });
    case "all-tasks":
      return defaultWorkQuery({ group: "project", sort: { field: "manual", direction: "asc" } });
  }
}

/** The heading of a group, as the list draws it. */
export function groupTitle(
  group: WorkGroupField,
  key: string,
  names: { person: (id: string) => string; project: (id: string) => string }
): string {
  switch (group) {
    case "status":
      return TASK_STATUS_LABELS[key as TaskStatus] ?? key;
    case "priority":
      return TASK_PRIORITY_LABELS[key as keyof typeof TASK_PRIORITY_LABELS] ?? key;
    case "assignee":
      return key === UNASSIGNED ? "Unassigned" : names.person(key);
    case "project":
      return names.project(key);
    case "due":
      return (
        { overdue: "Overdue", today: "Today", week: "Next 7 days", later: "Later", none: "No due date" } as Record<
          string,
          string
        >
      )[key] ?? key;
    case "none":
      return "All tasks";
  }
}

/** A stable tone for a person, so their initials keep one colour everywhere. */
export function personTone(id: string): Tone {
  const tones: Tone[] = ["blue", "green", "amber", "red", "purple", "gray"];
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return tones[Math.abs(hash) % tones.length]!;
}

/** "Ada Lovelace" -> "AL"; one name gives its first two letters. */
export function initials(name: string): string {
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}
