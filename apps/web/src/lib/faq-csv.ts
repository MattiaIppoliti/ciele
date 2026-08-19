/**
 * FAQ CSV import/export (the Knowledge → FAQs "Import FAQs" / "Export"
 * surface). The format is deliberately simple, exactly two columns,
 * question then answer, matching the reference platform's contract:
 * questions ≤1000 chars, answers ≤20000, file ≤10MB.
 *
 * Pure functions, client- and server-safe.
 */

export const FAQ_QUESTION_MAX = 1000;
export const FAQ_ANSWER_MAX = 20000;
export const FAQ_CSV_MAX_BYTES = 10 * 1024 * 1024;
/** Backstop so one import can't queue thousands of embedding calls. */
export const FAQ_IMPORT_MAX_ROWS = 500;

export interface FaqRow {
  question: string;
  answer: string;
}

export interface FaqCsvResult {
  rows: FaqRow[];
  /** 1-based line report for every skipped record, e.g. "row 4: answer exceeds 20000 characters". */
  skipped: string[];
}

/**
 * RFC-4180-ish CSV record reader: handles quoted fields, escaped quotes (""),
 * embedded commas/newlines, and CRLF. Returns raw records (arrays of fields).
 */
export function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;

  const pushField = () => {
    record.push(field);
    field = "";
  };
  const pushRecord = () => {
    pushField();
    records.push(record);
    record = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      pushField();
    } else if (ch === "\n") {
      pushRecord();
    } else if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      pushRecord();
    } else {
      field += ch;
    }
  }
  if (field !== "" || record.length > 0) pushRecord();

  // Drop records that are entirely empty (trailing newlines etc.).
  return records.filter((r) => r.some((f) => f.trim() !== ""));
}

/** True when a first record looks like a header ("question","answer"), so it can be skipped. */
function isHeader(record: string[]): boolean {
  const [a, b] = record.map((f) => f?.trim().toLowerCase());
  return a === "question" && (b === "answer" || b === "answers");
}

/**
 * Parses + validates an uploaded FAQ CSV into importable rows. Invalid rows
 * are reported, not fatal, a single bad line must not sink a 300-row import.
 */
export function parseFaqCsv(text: string): FaqCsvResult {
  const records = parseCsv(text);
  const rows: FaqRow[] = [];
  const skipped: string[] = [];

  records.forEach((record, index) => {
    const line = index + 1;
    if (index === 0 && isHeader(record)) return;
    if (record.length !== 2) {
      skipped.push(
        `row ${line}: expected 2 columns (question, answer), got ${record.length}`
      );
      return;
    }
    const question = record[0].trim();
    const answer = record[1].trim();
    if (!question || !answer) {
      skipped.push(`row ${line}: question and answer are both required`);
      return;
    }
    if (question.length > FAQ_QUESTION_MAX) {
      skipped.push(`row ${line}: question exceeds ${FAQ_QUESTION_MAX} characters`);
      return;
    }
    if (answer.length > FAQ_ANSWER_MAX) {
      skipped.push(`row ${line}: answer exceeds ${FAQ_ANSWER_MAX} characters`);
      return;
    }
    if (rows.length >= FAQ_IMPORT_MAX_ROWS) {
      skipped.push(`row ${line}: over the ${FAQ_IMPORT_MAX_ROWS}-row import limit`);
      return;
    }
    rows.push({ question, answer });
  });

  return { rows, skipped };
}

function escapeCsvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Serializes FAQs for the Export button, same two-column shape Import expects. */
export function serializeFaqCsv(rows: FaqRow[]): string {
  const lines = ["question,answer"];
  for (const row of rows) {
    lines.push(`${escapeCsvField(row.question)},${escapeCsvField(row.answer)}`);
  }
  return lines.join("\r\n") + "\r\n";
}
