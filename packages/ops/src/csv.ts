/**
 * The one CSV module for the repo. Two writers on purpose: `escapeCsvField`
 * is lossless, for files that are imported again (FAQ export), and
 * `tableToCsv` / `recordsToCsv` write files meant for a spreadsheet (Inbox,
 * Improvements and Insights exports), neutralising cells that would run as a
 * formula there. Zero dependencies and no operation imports, so a client
 * component can import this module without dragging the ops barrel into the
 * bundle (`@ciele/ops/csv`).
 */

/**
 * RFC-4180-ish CSV record reader: handles quoted fields, escaped quotes (""),
 * embedded commas/newlines, and CRLF. Returns raw records (arrays of fields);
 * records that are entirely blank (trailing newlines etc.) are dropped.
 */
export function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;
  const push = () => { row.push(field); field = ""; };
  const end = () => { push(); if (row.some((v) => v.trim())) records.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted && char === '"' && text[i + 1] === '"') { field += '"'; i++; }
    else if (char === '"') quoted = !quoted;
    else if (!quoted && char === ",") push();
    else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      end();
    } else field += char;
  }
  if (field || row.length) end();
  return records;
}

/**
 * Quotes a field only when it needs it (comma, quote, or newline inside).
 * Lossless, which is what a file meant to be imported again needs (the FAQ
 * export): it does not neutralise formulas. Files meant to be opened in a
 * spreadsheet go through `tableToCsv` / `recordsToCsv` instead.
 */
export function escapeCsvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * The characters that make Excel, Numbers and Sheets evaluate a cell as a
 * formula (OWASP "CSV injection"). A Conversation title or a Visitor's email
 * is text somebody else typed, so `=HYPERLINK(...)` in one must not run on the
 * admin's machine when they open the export.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

function spreadsheetCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  // Numbers are written as numbers: only text can carry a formula, and a
  // negative figure has to stay a figure.
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  const text = String(value);
  return escapeCsvField(FORMULA_START.test(text) ? `'${text}` : text);
}

/**
 * A table as a CSV meant to be opened in a spreadsheet: a header line, one
 * line per row, fields quoted only when they need it, and any text cell that
 * would run as a formula prefixed with an apostrophe.
 */
export function tableToCsv(
  headers: readonly string[],
  rows: ReadonlyArray<readonly unknown[]>,
): string {
  return [headers, ...rows].map((row) => row.map(spreadsheetCell).join(",")).join("\n");
}

/**
 * Records as a spreadsheet CSV. The columns come from the first record unless
 * given, which is also how an empty export still gets its header line.
 */
export function recordsToCsv(
  records: ReadonlyArray<Record<string, unknown>>,
  columns: readonly string[] = Object.keys(records[0] ?? {}),
): string {
  return tableToCsv(
    columns,
    records.map((record) => columns.map((column) => record[column])),
  );
}
