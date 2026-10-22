import type { ImprovementStatus, Task, TaskStatus } from "@agent-hub/core";
import { taskKey } from "@agent-hub/core";

/**
 * The link between an Improvement and the Tasks that resolve it, as the two
 * details draw it (ADR-0027 rule 2). Pure, so the order, the keys and the
 * count are tested here rather than in the `.tsx` vitest does not read.
 */

/** One row of an Improvement's Tasks section: what the list draws, no more. */
export interface ImprovementTaskRow {
  id: string;
  /** `KEY-n`, from the Task's Project. */
  key: string;
  title: string;
  status: TaskStatus;
  assigneeMemberId: string | null;
  archived: boolean;
  createdAt: string;
}

/** A Task as its Improvement lists it. `projectKey` is absent for a Project the reader cannot see. */
export function improvementTaskRow(task: Task, projectKey: string | undefined): ImprovementTaskRow {
  return {
    id: task.id,
    // The same fallback the work directory's `keyOf` uses.
    key: taskKey(projectKey ?? "TASK", task.seq),
    title: task.title,
    status: task.status,
    assigneeMemberId: task.assigneeMemberId,
    archived: Boolean(task.archivedAt),
    createdAt: task.createdAt,
  };
}

/** Work still moving, then finished work, then archived work; each in the order it was filed. */
function bucket(row: ImprovementTaskRow): number {
  if (row.archived) return 2;
  return row.status === "done" ? 1 : 0;
}

function sortRows(rows: ImprovementTaskRow[]): ImprovementTaskRow[] {
  return rows.sort(
    (a, b) =>
      bucket(a) - bucket(b) ||
      (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0) ||
      a.key.localeCompare(b.key)
  );
}

/** The Tasks that resolve an Improvement, keyed by their Projects and in list order. */
export function improvementTaskRows(
  tasks: readonly Task[],
  projects: readonly { id: string; key: string }[]
): ImprovementTaskRow[] {
  const keys = new Map(projects.map((project) => [project.id, project.key]));
  return sortRows(tasks.map((task) => improvementTaskRow(task, keys.get(task.projectId))));
}

/**
 * The server's rows plus the ones created here since they were read. The
 * server's copy wins, because it is the newer fact about a Task both hold; a
 * local row survives only until a refreshed read carries it.
 */
export function mergeImprovementTaskRows(
  server: readonly ImprovementTaskRow[],
  local: readonly ImprovementTaskRow[]
): ImprovementTaskRow[] {
  const known = new Set(server.map((row) => row.id));
  return sortRows([...server, ...local.filter((row) => !known.has(row.id))]);
}

/**
 * Done over live, the count ADR-0027 rule 3 moves an Improvement on: an
 * archived Task is neither, so archiving the last open one is what lets the
 * rest settle it.
 */
export function improvementTaskProgress(rows: readonly ImprovementTaskRow[]): { done: number; total: number } {
  const live = rows.filter((row) => !row.archived);
  return { done: live.filter((row) => row.status === "done").length, total: live.length };
}

/** What the Resolves picker offers (rule 2): an Improvement still open, so neither done nor archived. */
export interface ResolvableImprovement {
  id: string;
  seq: number;
  title: string;
  status: ImprovementStatus;
}

export function resolvableImprovements(
  improvements: readonly ResolvableImprovement[]
): ResolvableImprovement[] {
  return improvements
    .filter((improvement) => improvement.status !== "done" && improvement.status !== "archived")
    .map(({ id, seq, title, status }) => ({ id, seq, title, status }))
    .sort((a, b) => b.seq - a.seq);
}

/** The picker's filter: the `IMP-n` key or the title, case-insensitively. */
export function matchesImprovement(improvement: Pick<ResolvableImprovement, "seq" | "title">, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return `imp-${improvement.seq}`.includes(q) || improvement.title.toLowerCase().includes(q);
}
