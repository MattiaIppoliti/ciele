import type { ImprovementQuery, ImprovementStatus } from "@agent-hub/core";

// Storage-neutral pagination rules shared by both Db adapters.

/** A page size between 1 and 100. */
export function clampPageLimit(limit: number): number {
  return Math.max(1, Math.min(Math.trunc(limit), 100));
}

/** Rows fetched with `limit + 1`: the page, and a cursor naming its last
 * item only when the extra row came back. */
export function finalizePage<T>(
  rows: T[],
  limit: number,
  cursorOf: (item: T) => string,
): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, limit);
  return {
    items,
    nextCursor: rows.length > limit ? cursorOf(items.at(-1)!) : null,
  };
}

/** A memory subject cursor is `[lastMemoryAt, subjectId]` as JSON. */
export function decodeMemorySubjectCursor(cursor: string): [string, string] {
  try {
    const decoded = JSON.parse(cursor) as [string, string];
    if (typeof decoded[0] === "string" && typeof decoded[1] === "string") {
      return decoded;
    }
  } catch {
    // Unparseable: refused below, same as a malformed tuple.
  }
  throw new Error("Invalid memory subject cursor");
}

export function normalizeImprovementPageInput(input: {
  limit: number;
  cursor?: string | null;
  status?: ImprovementStatus;
}) {
  const parsedCursor = input.cursor ? Number(input.cursor) : null;
  return {
    limit: clampPageLimit(input.limit),
    beforeSeq:
      parsedCursor !== null && Number.isSafeInteger(parsedCursor)
        ? parsedCursor
        : null,
    status: input.status ?? null,
  };
}

export function finalizeImprovementPage<T extends { seq: number }>(
  rows: T[],
  limit: number,
) {
  return finalizePage(rows, limit, (item) => String(item.seq));
}

/**
 * The board's storage filters with every absent or blank key dropped, or null
 * when nothing narrows the read. `assigneeId: null` is a filter (unassigned
 * work), so it survives; an omitted key does not.
 */
export function improvementFilters(input: ImprovementQuery): ImprovementQuery | null {
  const filters: ImprovementQuery = {};
  const search = input.search?.trim();
  if (search) filters.search = search;
  if (input.priority) filters.priority = input.priority;
  if (input.assigneeId !== undefined) filters.assigneeId = input.assigneeId;
  if (input.projectId) filters.projectId = input.projectId;
  if (input.assistantId) filters.assistantId = input.assistantId;
  return Object.keys(filters).length > 0 ? filters : null;
}
