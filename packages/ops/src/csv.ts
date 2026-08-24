/**
 * The one CSV reader/writer pair for the repo (entity imports, FAQ
 * import/export, insights exports). Zero dependencies and no operation
 * imports, so a client component can import this module without dragging
 * the ops barrel into the bundle (`@ciele/ops/csv`).
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

/** Quotes a field only when it needs it (comma, quote, or newline inside). */
export function escapeCsvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
