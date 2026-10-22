import type {
  Task,
  TaskPriority,
  TaskStatus,
  WorkFilter,
  WorkFilterField,
  WorkGroupField,
  WorkLayout,
  WorkSortField,
  WorkViewQuery,
} from "./types";
import { TASK_PRIORITIES, TASK_STATUSES } from "./types";
import { TASK_PRIORITY_WEIGHT, daysBetween, dueBucket, type DueBucket } from "./work";

/**
 * The view engine's query language (#1050): one parser, one serialiser, one
 * predicate, one comparator, one grouping. The URL, a Saved View's body, the
 * server's read and the client's filter all go through these, so they agree by
 * construction.
 */

export const WORK_FILTER_FIELDS: readonly WorkFilterField[] = [
  "status",
  "assignee",
  "priority",
  "label",
  "project",
  "due",
  "created",
  "updated",
  "starred",
];

export const WORK_SORT_FIELDS: readonly WorkSortField[] = [
  "manual",
  "title",
  "due",
  "start",
  "priority",
  "status",
  "assignee",
  "created",
  "updated",
  "estimate",
  "project",
];

export const WORK_GROUP_FIELDS: readonly WorkGroupField[] = [
  "status",
  "priority",
  "assignee",
  "project",
  "due",
  "none",
];

export const WORK_LAYOUTS: readonly WorkLayout[] = ["list", "board", "table"];

/** The due filter's values, in the order a picker lists them. */
export const DUE_FILTER_VALUES = ["overdue", "today", "week", "later", "none"] as const;
/** The created/updated filter's values: within the last N days. */
export const RECENCY_FILTER_VALUES = ["1", "7", "30"] as const;

/** The unassigned sentinel in an assignee filter or group. */
export const UNASSIGNED = "none";

/** The starred filter's one value: `starred:is:yes`. */
export const STARRED = "yes";

export function defaultWorkQuery(overrides: Partial<WorkViewQuery> = {}): WorkViewQuery {
  return {
    filters: [],
    sort: { field: "manual", direction: "asc" },
    group: "status",
    text: "",
    ...overrides,
  };
}

// Serialisation ---------------------------------------------------------------------
//
// Flat string params, the shape `replaceFilterParams` keeps in the URL:
//   f     = status:is:to_do,in_progress;priority:not:none
//   sort  = due:asc
//   group = status
//   q     = free text
// Ids never contain `:`, `;` or `,`, so no escaping is needed beyond the URL's own.

const SAFE_VALUE = /^[A-Za-z0-9_.-]{1,64}$/;

export function serializeFilters(filters: readonly WorkFilter[]): string {
  return filters
    .filter((filter) => filter.values.length)
    .map((filter) => `${filter.field}:${filter.op}:${filter.values.join(",")}`)
    .join(";");
}

export function parseFilters(raw: string | null | undefined): WorkFilter[] {
  if (!raw) return [];
  const filters: WorkFilter[] = [];
  for (const part of raw.split(";")) {
    const [field, op, values] = part.split(":");
    if (!WORK_FILTER_FIELDS.includes(field as WorkFilterField)) continue;
    if (op !== "is" && op !== "not") continue;
    const list = (values ?? "").split(",").filter((value) => SAFE_VALUE.test(value));
    if (!list.length) continue;
    filters.push({ field: field as WorkFilterField, op, values: [...new Set(list)] });
  }
  return filters;
}

export function workQueryToParams(
  query: WorkViewQuery,
  defaults: WorkViewQuery = defaultWorkQuery()
): Record<string, string> {
  const sort = `${query.sort.field}:${query.sort.direction}`;
  const defaultSort = `${defaults.sort.field}:${defaults.sort.direction}`;
  return {
    f: serializeFilters(query.filters),
    sort: sort === defaultSort ? "" : sort,
    group: query.group === defaults.group ? "" : query.group,
    q: query.text,
  };
}

export function workQueryFromParams(
  params: { get(key: string): string | null } | Record<string, string | string[] | undefined>,
  defaults: WorkViewQuery = defaultWorkQuery()
): WorkViewQuery {
  const read = (key: string): string | null => {
    if (typeof (params as { get?: unknown }).get === "function") {
      return (params as { get(key: string): string | null }).get(key);
    }
    const value = (params as Record<string, string | string[] | undefined>)[key];
    return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
  };
  const [sortField, sortDirection] = (read("sort") ?? "").split(":");
  const group = read("group");
  return {
    filters: read("f") === null ? defaults.filters : parseFilters(read("f")),
    sort: WORK_SORT_FIELDS.includes(sortField as WorkSortField)
      ? {
          field: sortField as WorkSortField,
          direction: sortDirection === "desc" ? "desc" : "asc",
        }
      : defaults.sort,
    group: WORK_GROUP_FIELDS.includes(group as WorkGroupField)
      ? (group as WorkGroupField)
      : defaults.group,
    text: (read("q") ?? defaults.text).slice(0, 200),
  };
}

/** Normalises an untrusted Saved View body (jsonb) into a query. */
export function coerceWorkQuery(value: unknown): WorkViewQuery {
  const source = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const filters = Array.isArray(source.filters)
    ? parseFilters(
        serializeFilters(
          (source.filters as unknown[]).flatMap((entry) => {
            const filter = (entry ?? {}) as Partial<WorkFilter>;
            return typeof filter.field === "string" && Array.isArray(filter.values)
              ? [
                  {
                    field: filter.field,
                    op: filter.op === "not" ? "not" : "is",
                    values: filter.values.filter((v): v is string => typeof v === "string"),
                  } as WorkFilter,
                ]
              : [];
          })
        )
      )
    : [];
  const sort = (source.sort ?? {}) as Partial<WorkViewQuery["sort"]>;
  const fallback = defaultWorkQuery();
  return {
    filters,
    sort: WORK_SORT_FIELDS.includes(sort.field as WorkSortField)
      ? { field: sort.field as WorkSortField, direction: sort.direction === "desc" ? "desc" : "asc" }
      : fallback.sort,
    group: WORK_GROUP_FIELDS.includes(source.group as WorkGroupField)
      ? (source.group as WorkGroupField)
      : fallback.group,
    text: typeof source.text === "string" ? source.text.slice(0, 200) : "",
  };
}

// Matching ----------------------------------------------------------------------------

/** What the predicate needs beyond the Task row itself. */
export interface WorkViewContext {
  /** `YYYY-MM-DD` in the viewer's calendar. */
  today: string;
  /** ISO now, for created/updated recency. */
  now: string;
  /** Label ids per Task id. */
  labelsOf: (taskId: string) => readonly string[];
  /** The display key, for text search (`WEB-12`). */
  keyOf: (task: Task) => string;
  /** Display names for the assignee sort. */
  assigneeName?: (memberId: string) => string;
  /** Display names for the project sort and group order. */
  projectName?: (projectId: string) => string;
  /** Whether the viewer starred the Task (#1050's "starred" chip); unstarred when absent. */
  isStarred?: (taskId: string) => boolean;
}

function fieldValues(task: Task, field: WorkFilterField, ctx: WorkViewContext): string[] {
  switch (field) {
    case "status":
      return [task.status];
    case "priority":
      return [task.priority];
    case "assignee":
      return [task.assigneeMemberId ?? task.assigneeTeammateId ?? UNASSIGNED];
    case "label":
      return [...ctx.labelsOf(task.id)];
    case "project":
      return [task.projectId];
    case "due":
      return [dueBucket(task, ctx.today)];
    case "starred":
      return [ctx.isStarred?.(task.id) ? STARRED : "no"];
    case "created":
    case "updated": {
      const at = field === "created" ? task.createdAt : task.updatedAt;
      const age = (Date.parse(ctx.now) - Date.parse(at)) / 86_400_000;
      return RECENCY_FILTER_VALUES.filter((days) => age <= Number(days));
    }
  }
}

function matchesFilter(task: Task, filter: WorkFilter, ctx: WorkViewContext): boolean {
  const values = fieldValues(task, filter.field, ctx);
  const hit = filter.values.some((value) => values.includes(value));
  return filter.op === "is" ? hit : !hit;
}

export function matchesWorkQuery(task: Task, query: WorkViewQuery, ctx: WorkViewContext): boolean {
  const text = query.text.trim().toLowerCase();
  if (text && !task.title.toLowerCase().includes(text) && !ctx.keyOf(task).toLowerCase().includes(text)) {
    return false;
  }
  return query.filters.every((filter) => matchesFilter(task, filter, ctx));
}

// Sorting -------------------------------------------------------------------------------

const STATUS_ORDER = new Map<TaskStatus, number>(TASK_STATUSES.map((s, i) => [s, i]));

function compareNullable<T>(a: T | null, b: T | null, compare: (a: T, b: T) => number): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1; // nulls last in either direction
  if (b === null) return -1;
  return compare(a, b);
}

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const byNumber = (a: number, b: number) => a - b;

export function compareTasks(
  sort: WorkViewQuery["sort"],
  ctx: Pick<WorkViewContext, "assigneeName" | "projectName">
): (a: Task, b: Task) => number {
  const sign = sort.direction === "desc" ? -1 : 1;
  const primary = (a: Task, b: Task): number => {
    switch (sort.field) {
      case "manual":
        return sign * byString(a.rank, b.rank);
      case "title":
        return sign * a.title.localeCompare(b.title);
      case "due":
        return compareNullable(a.dueDate, b.dueDate, (x, y) => sign * byString(x, y));
      case "start":
        return compareNullable(a.startDate, b.startDate, (x, y) => sign * byString(x, y));
      case "priority":
        // "asc" means most urgent first, the order a person expects.
        return sign * (TASK_PRIORITY_WEIGHT[b.priority] - TASK_PRIORITY_WEIGHT[a.priority]);
      case "status":
        return sign * ((STATUS_ORDER.get(a.status) ?? 0) - (STATUS_ORDER.get(b.status) ?? 0));
      case "assignee": {
        const name = (task: Task) =>
          task.assigneeMemberId ? (ctx.assigneeName?.(task.assigneeMemberId) ?? task.assigneeMemberId) : null;
        return compareNullable(name(a), name(b), (x, y) => sign * x.localeCompare(y));
      }
      case "created":
        return sign * byString(a.createdAt, b.createdAt);
      case "updated":
        return sign * byString(a.updatedAt, b.updatedAt);
      case "estimate":
        return compareNullable(a.estimateMinutes, b.estimateMinutes, (x, y) => sign * byNumber(x, y));
      case "project": {
        const name = (task: Task) => ctx.projectName?.(task.projectId) ?? task.projectId;
        return sign * name(a).localeCompare(name(b));
      }
    }
  };
  // Ties fall back to the manual order, then the id, so a sort is total and a
  // re-render never shuffles equal rows.
  return (a, b) => primary(a, b) || byString(a.rank, b.rank) || byString(a.id, b.id);
}

// Grouping -------------------------------------------------------------------------------

export interface WorkGroup {
  /** The value this group sets on a Task dropped or created in it. */
  key: string;
  tasks: Task[];
}

const DUE_ORDER: readonly DueBucket[] = ["overdue", "today", "week", "later", "none"];

/**
 * Groups in display order. Status and priority list every group, even empty
 * ones (a board column with nothing in it is still a place to drop); the
 * others list only groups that have Tasks.
 */
export function groupTasks(
  tasks: readonly Task[],
  group: WorkGroupField,
  ctx: Pick<WorkViewContext, "today" | "assigneeName" | "projectName">
): WorkGroup[] {
  if (group === "none") return [{ key: "all", tasks: [...tasks] }];
  const keyOf = (task: Task): string => {
    switch (group) {
      case "status":
        return task.status;
      case "priority":
        return task.priority;
      case "assignee":
        return task.assigneeMemberId ?? task.assigneeTeammateId ?? UNASSIGNED;
      case "project":
        return task.projectId;
      case "due":
        return dueBucket(task, ctx.today);
    }
  };
  const buckets = new Map<string, Task[]>();
  const seed: readonly string[] =
    group === "status"
      ? TASK_STATUSES
      : group === "priority"
        ? TASK_PRIORITIES
        : group === "due"
          ? DUE_ORDER
          : [];
  for (const key of seed) buckets.set(key, []);
  for (const task of tasks) {
    const key = keyOf(task);
    const list = buckets.get(key) ?? [];
    list.push(task);
    buckets.set(key, list);
  }
  let groups = [...buckets.entries()].map(([key, list]) => ({ key, tasks: list }));
  if (group === "due") groups = groups.filter((g) => g.tasks.length);
  if (group === "assignee" || group === "project") {
    const name = (key: string) =>
      key === UNASSIGNED
        ? "￿"
        : group === "assignee"
          ? (ctx.assigneeName?.(key) ?? key)
          : (ctx.projectName?.(key) ?? key);
    groups.sort((a, b) => name(a.key).localeCompare(name(b.key)));
  }
  return groups;
}

/** The Task fields a group key sets, for a Task created or dropped into it. */
export function groupPatch(
  group: WorkGroupField,
  key: string,
  today: string
): Partial<Pick<Task, "status" | "priority" | "assigneeMemberId" | "projectId" | "dueDate">> {
  switch (group) {
    case "status":
      return TASK_STATUSES.includes(key as TaskStatus) ? { status: key as TaskStatus } : {};
    case "priority":
      return TASK_PRIORITIES.includes(key as TaskPriority) ? { priority: key as TaskPriority } : {};
    case "assignee":
      return { assigneeMemberId: key === UNASSIGNED ? null : key };
    case "project":
      return { projectId: key };
    case "due": {
      const offsets: Partial<Record<DueBucket, number | null>> = {
        today: 0,
        week: 3,
        later: 14,
        none: null,
      };
      if (!(key in offsets)) return {};
      const offset = offsets[key as DueBucket];
      if (offset === null || offset === undefined) return { dueDate: null };
      const date = new Date(`${today}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + offset);
      return { dueDate: date.toISOString().slice(0, 10) };
    }
    case "none":
      return {};
  }
}

/** Days from today to a due date, negative when overdue; null with no date. */
export function daysUntilDue(task: Pick<Task, "dueDate">, today: string): number | null {
  return task.dueDate ? daysBetween(today, task.dueDate) : null;
}
