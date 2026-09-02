import type { ImprovementListItem, ImprovementStatus } from "@agent-hub/core";
import { listAllImprovementsAction } from "@/app/actions";
import {
  improvementKey,
  matchesImprovementFilters,
  type ImprovementFilters,
} from "@/lib/improvements";

/**
 * The export path of the Improvements board, loaded with `import()` from the
 * click handler so the board's initial bundle never pays for it.
 *
 * Exports read the whole tracker (or one lane) from the server rather than
 * the rows the board happens to hold: the board pages each lane, so "what is
 * loaded" is a window, and a report built from a window is wrong in a way
 * nobody notices until an old In-Progress item is missing from it.
 */
/** The board's filters, applied to the rows the export reads from the server. */
export type ImprovementExportFilters = ImprovementFilters;

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

function download(
  name: string,
  rows: Record<string, unknown>[],
  format: "csv" | "json",
) {
  let blob: Blob;
  if (format === "json") {
    blob = new Blob([JSON.stringify(rows, null, 2)], {
      type: "application/json",
    });
  } else {
    const headers = Object.keys(rows[0] ?? { key: "" });
    const escape = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
    const csv = [
      headers.join(","),
      ...rows.map((r) => headers.map((h) => escape(r[h])).join(",")),
    ].join("\n");
    blob = new Blob([csv], { type: "text/csv" });
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** Fetches every matching row from the server and hands the file to the browser. */
export async function exportImprovements(options: {
  status?: ImprovementStatus;
  filters: ImprovementExportFilters;
  format: "csv" | "json";
  emailOf: (userId: string | null) => string | null;
}): Promise<number> {
  const rows = (await listAllImprovementsAction(options.status)).filter((row) =>
    matchesImprovementFilters(row, options.filters),
  );
  const name = options.status
    ? `improvements-${options.status}.${options.format}`
    : `improvements.${options.format}`;
  download(
    name,
    rows.map((row) => toImprovementExportRow(row, options.emailOf(row.assigneeId))),
    options.format,
  );
  return rows.length;
}
