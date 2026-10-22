import type {
  ImprovementStatus,
  MemberNotificationKind,
  Project,
  Role,
  Task,
  TaskDependency,
  TaskPriority,
  TaskRecurrence,
  TaskStatus,
} from "./types";
import { memberRoleRank } from "./teammate-grants";

/**
 * The work domain's pure rules (map #1039, spec #1059): ordering, keys, the
 * nesting and dependency invariants, estimates, recurrence, progress, the
 * visibility rule, mention tokens, who a change notifies, and the
 * Improvement's move to In Review. No I/O; the operations layer composes them.
 */

// Ordering ------------------------------------------------------------------------

/**
 * Base-62 digits in byte order, so the database's `collate "C"` and
 * JavaScript's string comparison agree on every key.
 */
const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/**
 * A key strictly between `a` and `b` (either may be null for an open end).
 *
 * Keys are base-62 fractions (`"V"` is 31/62) that never end in the smallest
 * digit, which is what guarantees there is always room between two of them.
 * A float halved on every insert runs out of precision after ~50 moves into
 * the same gap; a string only grows by a character.
 */
export function rankBetween(a: string | null, b: string | null): string {
  const lo = a ?? "";
  if (b !== null && lo >= b) {
    throw new Error(`rankBetween: ${JSON.stringify(a)} is not below ${JSON.stringify(b)}`);
  }
  if (lo.endsWith("0") || (b !== null && b.endsWith("0"))) {
    throw new Error("rankBetween: a key never ends in the smallest digit");
  }
  return midpoint(lo, b);
}

function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    // Shared prefix: recurse under it.
    let n = 0;
    while ((a[n] ?? "0") === b[n]) n += 1;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const digitA = a ? DIGITS.indexOf(a[0]!) : 0;
  const digitB = b !== null ? DIGITS.indexOf(b[0]!) : DIGITS.length;
  if (digitB - digitA > 1) {
    return DIGITS[Math.round((digitA + digitB) / 2)]!;
  }
  // Adjacent first digits.
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return DIGITS[digitA]! + midpoint(a.slice(1), null);
}

/** `count` ascending keys after `after` (null: from the start), for bulk inserts. */
export function ranksAfter(after: string | null, count: number): string[] {
  const keys: string[] = [];
  let previous = after;
  for (let i = 0; i < count; i += 1) {
    previous = rankBetween(previous, null);
    keys.push(previous);
  }
  return keys;
}

// Keys --------------------------------------------------------------------------

export const PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9]{1,4}$/;

/** `WEB-12`. */
export function taskKey(projectKey: string, seq: number): string {
  return `${projectKey}-${seq}`;
}

/**
 * A Project key from its name, unique among `taken`. The same rule the
 * 20261009100000 migration used to backfill existing Projects: the initials of
 * the name's words (at most three), padded from its letters to two, then a
 * number appended until unique.
 */
export function deriveProjectKey(name: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((key) => key.toUpperCase()));
  const letters = name
    .normalize("NFD")
    .replace(/[^A-Za-z ]/g, "")
    .toUpperCase()
    .trim();
  let base = letters
    .split(/ +/)
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .slice(0, 3);
  if (base.length < 2) base = (letters.replace(/ /g, "") + "PR").slice(0, 2);
  let candidate = base;
  for (let n = 2; used.has(candidate); n += 1) candidate = `${base.slice(0, 3)}${n}`;
  return candidate;
}

// Nesting and dependencies --------------------------------------------------------

/**
 * Whether `child` may become a subtask of `parent`: one level deep (#1049), so
 * the parent is not itself a subtask and the child has none of its own, and
 * both live in one Project. A Task still being created has no id yet.
 */
export function canNestUnder(
  parent: Pick<Task, "id" | "parentId" | "projectId">,
  child: Pick<Task, "projectId"> & Partial<Pick<Task, "id">>,
  childHasSubtasks: boolean
): boolean {
  return (
    parent.id !== child.id &&
    parent.parentId === null &&
    parent.projectId === child.projectId &&
    !childHasSubtasks
  );
}

/**
 * Whether adding "`taskId` is blocked by `blockedById`" closes a loop: it does
 * when `taskId` is already reachable from `blockedById` through blocked-by
 * edges (or they are the same Task).
 */
export function wouldCreateCycle(
  edges: readonly Pick<TaskDependency, "taskId" | "blockedById">[],
  taskId: string,
  blockedById: string
): boolean {
  if (taskId === blockedById) return true;
  const next = new Map<string, string[]>();
  for (const edge of edges) {
    const list = next.get(edge.taskId) ?? [];
    list.push(edge.blockedById);
    next.set(edge.taskId, list);
  }
  const seen = new Set<string>();
  const stack = [blockedById];
  while (stack.length) {
    const current = stack.pop()!;
    if (current === taskId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...(next.get(current) ?? []));
  }
  return false;
}

// Estimates -----------------------------------------------------------------------

/** One working day, for display only: `1d` is eight hours of work. */
export const WORKDAY_MINUTES = 8 * 60;

/** The estimate picker's presets, as minutes: 30m 1h 2h 4h 1d 2d 3d 5d 8d. */
export const ESTIMATE_PRESETS: readonly number[] = [30, 60, 120, 240, 480, 960, 1440, 2400, 3840];

/** `90` → `"1h 30m"`, `960` → `"2d"`. */
export function formatEstimate(minutes: number | null): string {
  if (minutes === null || minutes <= 0) return "";
  const days = Math.floor(minutes / WORKDAY_MINUTES);
  const hours = Math.floor((minutes % WORKDAY_MINUTES) / 60);
  const rest = minutes % 60;
  return [days ? `${days}d` : "", hours ? `${hours}h` : "", rest ? `${rest}m` : ""]
    .filter(Boolean)
    .join(" ");
}

/**
 * `"1d 2h"`, `"90m"`, `"1.5h"` → minutes; a bare number is hours, the unit a
 * person typing into an estimate field almost always means. Null when the
 * text is empty or not an estimate.
 */
export function parseEstimate(text: string): number | null {
  const trimmed = text.trim().toLowerCase();
  if (!trimmed) return null;
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const minutes = Math.round(Number(trimmed) * 60);
    return minutes > 0 ? minutes : null;
  }
  const pattern = /(\d+(?:\.\d+)?)\s*(d|h|m)/g;
  let total = 0;
  let consumed = "";
  for (const match of trimmed.matchAll(pattern)) {
    const value = Number(match[1]);
    total += match[2] === "d" ? value * WORKDAY_MINUTES : match[2] === "h" ? value * 60 : value;
    consumed += match[0];
  }
  if (consumed.replace(/\s/g, "") !== trimmed.replace(/\s/g, "")) return null;
  const minutes = Math.round(total);
  return minutes > 0 ? minutes : null;
}

// Dates and recurrence ------------------------------------------------------------

function parseDay(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

function formatDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` plus `days` (negative goes back). */
export function addDays(day: string, days: number): string {
  const date = parseDay(day);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDay(date);
}

/** Calendar months, clamped: 31 Jan + 1 month is 28 (or 29) Feb, not 3 Mar. */
export function addMonths(day: string, months: number): string {
  const date = parseDay(day);
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return formatDay(target);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  return Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / 86_400_000);
}

/** The next date a recurrence lands on after `day`. */
function nextRecurrenceDay(day: string, recurrence: TaskRecurrence): string {
  switch (recurrence) {
    case "daily":
      return addDays(day, 1);
    case "weekly":
      return addDays(day, 7);
    case "biweekly":
      return addDays(day, 14);
    case "monthly":
      return addMonths(day, 1);
  }
}

/**
 * The dates of the next copy of a recurring Task, created when this one is
 * completed (#1049). Null when there is no due date to recur from: a
 * recurrence without a date has no "next".
 */
export function nextOccurrence(
  task: Pick<Task, "startDate" | "dueDate" | "recurrence">
): { startDate: string | null; dueDate: string } | null {
  if (!task.recurrence || !task.dueDate) return null;
  const dueDate = nextRecurrenceDay(task.dueDate, task.recurrence);
  const startDate = task.startDate
    ? addDays(dueDate, -daysBetween(task.startDate, task.dueDate))
    : null;
  return { startDate, dueDate };
}

/** The bucket a due date falls in, relative to `today` (`YYYY-MM-DD`). */
export type DueBucket = "overdue" | "today" | "week" | "later" | "none";

export function dueBucket(task: Pick<Task, "dueDate" | "status">, today: string): DueBucket {
  if (!task.dueDate) return "none";
  const delta = daysBetween(today, task.dueDate);
  if (delta < 0) return task.status === "done" ? "later" : "overdue";
  if (delta === 0) return "today";
  if (delta <= 7) return "week";
  return "later";
}

export function isOverdue(task: Pick<Task, "dueDate" | "status">, today: string): boolean {
  return task.status !== "done" && !!task.dueDate && task.dueDate < today;
}

/** My Tasks' fixed groups (#1050), in display order. */
export const MY_TASK_GROUPS = ["overdue", "today", "upcoming", "no_date", "completed"] as const;
export type MyTaskGroup = (typeof MY_TASK_GROUPS)[number];

export function myTaskGroup(task: Pick<Task, "dueDate" | "status">, today: string): MyTaskGroup {
  if (task.status === "done") return "completed";
  if (!task.dueDate) return "no_date";
  if (task.dueDate < today) return "overdue";
  if (task.dueDate === today) return "today";
  return "upcoming";
}

// Status, priority, progress -------------------------------------------------------

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: "Backlog",
  to_do: "To do",
  in_progress: "In progress",
  in_review: "In review",
  done: "Done",
};

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
  none: "No priority",
};

/** Sort weight: urgent first. */
export const TASK_PRIORITY_WEIGHT: Record<TaskPriority, number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
  none: 0,
};

export const TASK_RECURRENCE_LABELS: Record<TaskRecurrence, string> = {
  daily: "Daily",
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
};

/**
 * A Task's progress, 0-100: done is 100; otherwise its subtasks' completion
 * when it has any; otherwise a figure per status. Fills the timeline bar.
 */
export function taskProgress(
  task: Pick<Task, "status">,
  subtasks: readonly Pick<Task, "status" | "archivedAt">[] = []
): number {
  if (task.status === "done") return 100;
  const live = subtasks.filter((sub) => !sub.archivedAt);
  if (live.length) {
    return Math.round((live.filter((sub) => sub.status === "done").length / live.length) * 100);
  }
  return { backlog: 0, to_do: 5, in_progress: 45, in_review: 80, done: 100 }[task.status];
}

/** A Project's progress over its live top-level Tasks. */
export function projectProgress(tasks: readonly Pick<Task, "status" | "archivedAt" | "parentId">[]): {
  done: number;
  total: number;
  percent: number;
} {
  const live = tasks.filter((task) => !task.archivedAt && task.parentId === null);
  const done = live.filter((task) => task.status === "done").length;
  return { done, total: live.length, percent: live.length ? Math.round((done / live.length) * 100) : 0 };
}

/**
 * The status change a completion toggle makes, with the timestamp the
 * `completed_at` invariant requires. Reopening goes to To do (#1049).
 */
export function statusPatch(
  status: TaskStatus,
  now: string
): { status: TaskStatus; completedAt: string | null } {
  return { status, completedAt: status === "done" ? now : null };
}

// Visibility ------------------------------------------------------------------------

export interface ProjectViewer {
  userId: string;
  role: Role | null;
}

/**
 * The work visibility rule (#1047): an org-visible Project, or a private one the
 * viewer sits on or administers. Mirrors `private.can_read_project` in the
 * 20261009100000 migration; change both.
 *
 * The creator reads a private Project only while nobody is seated on it, the
 * instant between creating it and seating themselves. Once members exist, a
 * creator removed in Share loses it like anyone else: "visible only to its
 * members and to Owners and Admins".
 */
export function canReadProject(
  project: Pick<Project, "visibility" | "createdBy">,
  memberIds: Iterable<string>,
  viewer: ProjectViewer
): boolean {
  if (memberRoleRank(viewer.role) < 1) return false;
  if (project.visibility === "organization") return true;
  if (memberRoleRank(viewer.role) >= 3) return true;
  const seated = [...memberIds];
  if (seated.includes(viewer.userId)) return true;
  return seated.length === 0 && !!project.createdBy && project.createdBy === viewer.userId;
}

/** Read access plus at least the Editor rung. */
export function canWriteProject(
  project: Pick<Project, "visibility" | "createdBy">,
  memberIds: Iterable<string>,
  viewer: ProjectViewer
): boolean {
  return memberRoleRank(viewer.role) >= 2 && canReadProject(project, memberIds, viewer);
}

/** An assignee is at least an Editor (#1047): a Viewer could not move it to Done. */
export function canBeAssignee(role: Role | null | undefined): boolean {
  return memberRoleRank(role) >= 2;
}

// Mentions ----------------------------------------------------------------------------

/**
 * Mention tokens (#1041): `@[Name](member:<uuid>)`. The id is what survives a
 * rename; the name is only what the author saw.
 */
const MENTION_TOKEN = /@\[([^\]\n]{1,80})\]\(member:([0-9a-zA-Z-]{1,64})\)/g;

export function mentionToken(name: string, memberId: string): string {
  return `@[${name.replace(/[\]\n]/g, "")}](member:${memberId})`;
}

/** The distinct Member ids a body mentions, in first-seen order. */
export function parseMentionTokens(body: string): string[] {
  const ids: string[] = [];
  for (const match of body.matchAll(MENTION_TOKEN)) {
    if (!ids.includes(match[2]!)) ids.push(match[2]!);
  }
  return ids;
}

export type MentionSegment =
  | { kind: "text"; text: string }
  | { kind: "mention"; name: string; memberId: string };

/** A body split into text and mentions, for rendering chips. */
export function splitMentionTokens(body: string): MentionSegment[] {
  const segments: MentionSegment[] = [];
  let last = 0;
  for (const match of body.matchAll(MENTION_TOKEN)) {
    const index = match.index ?? 0;
    if (index > last) segments.push({ kind: "text", text: body.slice(last, index) });
    segments.push({ kind: "mention", name: match[1]!, memberId: match[2]! });
    last = index + match[0].length;
  }
  if (last < body.length) segments.push({ kind: "text", text: body.slice(last) });
  return segments;
}

/** Plain text for an excerpt or an email: tokens become `@Name`. */
export function mentionTokensToText(body: string): string {
  return body.replace(MENTION_TOKEN, (_whole, name: string) => `@${name}`);
}

// Notifications ------------------------------------------------------------------------

/** What happened, in the terms the recipient rule needs (#1048). */
export type WorkNotificationEvent =
  | { kind: "assigned"; actorId: string | null; assigneeId: string | null; previousAssigneeId: string | null }
  | {
      kind: "commented";
      actorId: string | null;
      commentId: string;
      mentions: readonly string[];
      task: Pick<Task, "assigneeMemberId" | "createdBy">;
    }
  | {
      kind: "described";
      actorId: string | null;
      addedMentions: readonly string[];
    }
  | {
      /** An edit that mentions someone new: only they hear, as a mention. */
      kind: "comment_edited";
      actorId: string | null;
      commentId: string;
      addedMentions: readonly string[];
    }
  | {
      kind: "status_changed";
      actorId: string | null;
      from: TaskStatus;
      to: TaskStatus;
      task: Pick<Task, "assigneeMemberId" | "createdBy">;
    };

export interface WorkNotificationRecipient {
  recipientId: string;
  kind: MemberNotificationKind;
  commentId: string | null;
}

/**
 * Who a change notifies, and as what. Never the actor. A comment that mentions
 * someone notifies them once, as a mention, not again as a comment.
 * `canNotify` is the caller's check that a recipient can still see the Task
 * (a Member removed from a private Project gets nothing).
 */
export function workNotificationRecipients(
  event: WorkNotificationEvent,
  canNotify: (memberId: string) => boolean = () => true
): WorkNotificationRecipient[] {
  const out: WorkNotificationRecipient[] = [];
  const add = (recipientId: string | null, kind: MemberNotificationKind, commentId: string | null = null) => {
    if (!recipientId || recipientId === event.actorId) return;
    if (out.some((row) => row.recipientId === recipientId)) return;
    if (!canNotify(recipientId)) return;
    out.push({ recipientId, kind, commentId });
  };
  switch (event.kind) {
    case "assigned":
      if (event.assigneeId !== event.previousAssigneeId) add(event.assigneeId, "assigned");
      break;
    case "commented":
      for (const id of event.mentions) add(id, "mentioned", event.commentId);
      add(event.task.assigneeMemberId, "commented", event.commentId);
      add(event.task.createdBy, "commented", event.commentId);
      break;
    case "described":
      for (const id of event.addedMentions) add(id, "mentioned");
      break;
    case "comment_edited":
      for (const id of event.addedMentions) add(id, "mentioned", event.commentId);
      break;
    case "status_changed":
      if (event.from !== event.to) {
        add(event.task.assigneeMemberId, "status_changed");
        add(event.task.createdBy, "status_changed");
      }
      break;
  }
  return out;
}

// Improvements ------------------------------------------------------------------------

/**
 * ADR-0027 rule 3: when every Task that resolves an Improvement is Done, an
 * Improvement still in To do or In progress moves to In review, and a person
 * closes it. Reopening a Task never moves it back. Null when nothing moves.
 */
export function improvementStatusAfterTasks(
  improvementStatus: ImprovementStatus,
  linkedTasks: readonly Pick<Task, "status" | "archivedAt">[]
): ImprovementStatus | null {
  if (improvementStatus !== "to_do" && improvementStatus !== "in_progress") return null;
  const live = linkedTasks.filter((task) => !task.archivedAt);
  if (!live.length) return null;
  return live.every((task) => task.status === "done") ? "in_review" : null;
}
