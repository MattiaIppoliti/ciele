/** Client-safe shape rules for streamed and persisted Beautiful UI table replies. */
export const INTERACTIVE_TABLE_LIMITS = {
  rows: 100,
  text: 300,
  tags: 12,
} as const;
export type RecordStrength =
  "strong" | "weak" | "veryweak" | "none" | "unknown";
export type TaskStatus = "todo" | "progress" | "done";
export type RecordRow = {
  id: string;
  name: string;
  tags: string[];
  last: string;
  strength: RecordStrength;
  website?: string;
  additional?: string;
};
export type FilterRow = {
  task: string;
  date: string;
  status: TaskStatus;
  owner: string;
};
export type FilterLabels = {
  columns: { task: string; date: string; status: string; owner: string };
};

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}
function text(value: unknown) {
  return typeof value === "string"
    ? value.slice(0, INTERACTIVE_TABLE_LIMITS.text)
    : "";
}
/** Model-supplied links may never become executable or credential-bearing URLs. */
export function tableWebsite(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim() || value.length > 2048) return;
  try {
    const url = new URL(
      /^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`,
    );
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return;
    return url.href;
  } catch {
    return;
  }
}
export function normalizeRecordsTable(value: unknown) {
  const raw = object(value);
  if (!raw || !Array.isArray(raw.rows)) return null;
  const rows: RecordRow[] = [];
  const ids = new Set<string>();
  for (const entry of raw.rows.slice(0, INTERACTIVE_TABLE_LIMITS.rows)) {
    const row = object(entry);
    if (!row || !text(row.id) || !text(row.name) || ids.has(text(row.id)))
      continue;
    const strength = row.strength;
    if (
      strength !== "strong" &&
      strength !== "weak" &&
      strength !== "veryweak" &&
      strength !== "none" &&
      strength !== "unknown"
    )
      continue;
    ids.add(text(row.id));
    const website = tableWebsite(row.website);
    rows.push({
      id: text(row.id),
      name: text(row.name),
      tags: Array.isArray(row.tags)
        ? [
            ...new Set(
              row.tags
                .filter((tag): tag is string => typeof tag === "string")
                .slice(0, INTERACTIVE_TABLE_LIMITS.tags)
                .map(text),
            ),
          ]
        : [],
      last: text(row.last),
      strength,
      ...(website ? { website } : {}),
      ...(typeof row.additional === "string"
        ? { additional: text(row.additional) }
        : {}),
    });
  }
  return {
    title: text(raw.title),
    caption: text(raw.caption),
    rows,
    additionalColumn: text(raw.additionalColumn),
  };
}
export function normalizeFilterTable(value: unknown) {
  const raw = object(value);
  if (!raw || !Array.isArray(raw.rows)) return null;
  const rows: FilterRow[] = [];
  for (const entry of raw.rows.slice(0, INTERACTIVE_TABLE_LIMITS.rows)) {
    const row = object(entry);
    if (!row || !text(row.task)) continue;
    const status = row.status;
    if (status !== "todo" && status !== "progress" && status !== "done")
      continue;
    rows.push({
      task: text(row.task),
      date: text(row.date),
      status,
      owner: text(row.owner),
    });
  }
  const columns = object(object(raw.labels)?.columns);
  const labels: FilterLabels = {
    columns: {
      task: text(columns?.task) || "Task name",
      date: text(columns?.date) || "Date",
      status: text(columns?.status) || "Status",
      owner: text(columns?.owner) || "Advisor",
    },
  };
  return { title: text(raw.title), caption: text(raw.caption), rows, labels };
}
export function filterTableCounts(rows: readonly FilterRow[]) {
  return {
    all: rows.length,
    todo: rows.filter((row) => row.status === "todo").length,
    progress: rows.filter((row) => row.status === "progress").length,
    done: rows.filter((row) => row.status === "done").length,
  };
}
