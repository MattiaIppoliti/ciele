import type { ImprovementListItem, ImprovementStatus } from "@agent-hub/core";
import { listAllImprovementsAction } from "@/app/actions";
import {
  improvementKey,
  matchesImprovementFilters,
  type ImprovementFilters,
} from "@/lib/improvements";
import { downloadRows } from "@/lib/download";

/**
 * The export path of the Improvements board, loaded with `import()` from the
 * click handler so the board's initial bundle never pays for it.
 *
 * Exports read the whole tracker (or one lane) from the server rather than
 * the rows the board happens to hold: the board pages each lane, so "what is
 * loaded" is a window, and a report built from a window is wrong in a way
 * nobody notices until an old In-Progress item is missing from it.
 */
export function toImprovementExportRow(
  row: ImprovementListItem,
  assigneeEmail: string | null,
) {
  return {
    key: improvementKey(row.seq),
    title: row.title,
    status: row.status,
    priority: row.priority,
    tags: row.tags.join("; "),
    assignee: assigneeEmail ?? "",
    occurrences: row.messageCount,
    dueDate: row.dueDate ?? "",
    createdAt: row.createdAt,
  };
}

/** Fetches every matching row from the server and hands the file to the browser. */
export async function exportImprovements(options: {
  status?: ImprovementStatus;
  /** The board's filters, applied to the rows the export reads from the server. */
  filters: ImprovementFilters;
  format: "csv" | "json";
  emailOf: (userId: string | null) => string | null;
}): Promise<number> {
  const rows = (await listAllImprovementsAction(options.status)).filter((row) =>
    matchesImprovementFilters(row, options.filters),
  );
  const name = options.status
    ? `improvements-${options.status}.${options.format}`
    : `improvements.${options.format}`;
  // Titles and tags are text other people typed, and the file is opened in a
  // spreadsheet: `downloadRows` neutralises what would run there.
  downloadRows(
    rows.map((row) => toImprovementExportRow(row, options.emailOf(row.assigneeId))),
    options.format,
    name,
    ["key"],
  );
  return rows.length;
}
