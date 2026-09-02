import type { ImprovementStatus } from "@agent-hub/core";

/** Storage-neutral pagination rules shared by both Db adapters. */
export function normalizeImprovementPageInput(input: {
  limit: number;
  cursor?: string | null;
  status?: ImprovementStatus;
}) {
  const parsedCursor = input.cursor ? Number(input.cursor) : null;
  return {
    limit: Math.max(1, Math.min(Math.trunc(input.limit), 100)),
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
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  return {
    items,
    nextCursor: hasMore ? String(items.at(-1)?.seq) : null,
  };
}
