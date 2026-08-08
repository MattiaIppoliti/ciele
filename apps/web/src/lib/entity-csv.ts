/**
 * Entity Records CSV import (#663): header-mapped rows validated against the
 * Entity's typed attribute schema, upserted by the key attribute. Pure
 * functions, client- and server-safe. The record parser is shared with the
 * FAQ import (`parseCsv`).
 */

import type {
  Entity,
  EntityAttribute,
  EntityRecordValue,
} from "@agent-hub/core";
import { coerceEntityValue } from "@agent-hub/core";
import { parseCsv } from "./faq-csv";

export const ENTITY_CSV_MAX_BYTES = 10 * 1024 * 1024;
/** Backstop so one paste can't turn into an unbounded write burst. */
export const ENTITY_IMPORT_MAX_ROWS = 5000;

export interface EntityCsvResult {
  rows: Array<{ key: string; values: Record<string, EntityRecordValue> }>;
  /** 1-based line report for every rejected record. */
  rejected: string[];
}


/** Header → attribute matching is forgiving: key or label, case-insensitive. */
function matchAttribute(
  header: string,
  attributes: EntityAttribute[]
): EntityAttribute | null {
  const wanted = header.trim().toLowerCase();
  return (
    attributes.find((a) => a.key.toLowerCase() === wanted) ??
    attributes.find((a) => a.label.trim().toLowerCase() === wanted) ??
    null
  );
}

/**
 * Coerce one raw value (CSV cell string OR native JSON value — the sync
 * ingestion path, #670) to the attribute's type. One implementation for
 * both import paths so their validation semantics can never drift.
 */
const parseCell = coerceEntityValue;

/**
 * Parse a CSV export against an Entity's schema. The first record is the
 * header row; every header must match an attribute (unknown columns are a
 * per-import rejection so silent data loss can't happen), the key attribute's
 * column must be present, and each row needs a non-empty key value. Bad rows
 * are reported and skipped — one bad row never blocks the batch.
 */
export function parseEntityCsv(
  text: string,
  entity: Pick<Entity, "attributes" | "keyAttribute">
): EntityCsvResult {
  if (new TextEncoder().encode(text).length > ENTITY_CSV_MAX_BYTES) {
    return { rows: [], rejected: ["file exceeds the 10MB limit"] };
  }
  const records = parseCsv(text).filter(
    (r) => !(r.length === 1 && r[0].trim() === "")
  );
  if (records.length === 0) {
    return { rows: [], rejected: ["the file is empty"] };
  }

  const [headerRow, ...dataRows] = records;
  const columns: Array<EntityAttribute | null> = headerRow.map((h) =>
    matchAttribute(h, entity.attributes)
  );
  const unknown = headerRow.filter((_, i) => columns[i] === null);
  if (unknown.length > 0) {
    return {
      rows: [],
      rejected: [
        `unknown column${unknown.length > 1 ? "s" : ""}: ${unknown
          .map((h) => `"${h.trim()}"`)
          .join(", ")}`,
      ],
    };
  }
  if (!columns.some((a) => a?.key === entity.keyAttribute)) {
    return {
      rows: [],
      rejected: [`missing the key column "${entity.keyAttribute}"`],
    };
  }

  const rows: EntityCsvResult["rows"] = [];
  const rejected: string[] = [];
  const seenKeys = new Set<string>();

  for (const [index, record] of dataRows.entries()) {
    const line = index + 2; // 1-based, after the header
    if (rows.length >= ENTITY_IMPORT_MAX_ROWS) {
      rejected.push(
        `row ${line} and beyond: import capped at ${ENTITY_IMPORT_MAX_ROWS} rows`
      );
      break;
    }
    const values: Record<string, EntityRecordValue> = {};
    let rowError: string | null = null;
    for (const [col, attribute] of columns.entries()) {
      if (!attribute) continue;
      const parsed = parseCell(record[col] ?? "", attribute);
      if (!parsed.ok) {
        rowError = parsed.reason;
        break;
      }
      values[attribute.key] = parsed.value;
    }
    if (rowError) {
      rejected.push(`row ${line}: ${rowError}`);
      continue;
    }
    const keyValue = values[entity.keyAttribute];
    if (keyValue === null || keyValue === undefined || keyValue === "") {
      rejected.push(`row ${line}: empty key value ("${entity.keyAttribute}")`);
      continue;
    }
    const key = String(keyValue);
    if (seenKeys.has(key)) {
      rejected.push(`row ${line}: duplicate key "${key}" (first one wins)`);
      continue;
    }
    seenKeys.add(key);
    rows.push({ key, values });
  }

  return { rows, rejected };
}
