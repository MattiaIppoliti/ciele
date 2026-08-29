import type { EntityAttribute, EntityRecordValue } from "./types";

const CELL_MAX = 4000;
const TRUE_WORDS = new Set(["true", "yes", "1"]);
const FALSE_WORDS = new Set(["false", "no", "0"]);

/** Shared CSV/JSON coercion for Entity Record ingestion. */
export function coerceEntityValue(
  raw: unknown,
  attribute: EntityAttribute
): { ok: true; value: EntityRecordValue } | { ok: false; reason: string } {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw === "string" && raw.trim() === "") return { ok: true, value: null };
  switch (attribute.type) {
    case "text": {
      if (typeof raw === "object") return { ok: false, reason: `${attribute.key} is not text` };
      const value = String(raw).trim();
      return value.length <= CELL_MAX
        ? { ok: true, value }
        : { ok: false, reason: `${attribute.key} exceeds ${CELL_MAX} characters` };
    }
    case "number": {
      const value = typeof raw === "number" ? raw : Number(String(raw).trim());
      return Number.isFinite(value)
        ? { ok: true, value }
        : { ok: false, reason: `${attribute.key} is not a number: "${String(raw)}"` };
    }
    case "date": {
      const value = String(raw).trim();
      return Number.isNaN(Date.parse(value))
        ? { ok: false, reason: `${attribute.key} is not a date: "${value}"` }
        : { ok: true, value };
    }
    case "boolean": {
      if (typeof raw === "boolean") return { ok: true, value: raw };
      const value = String(raw).trim().toLowerCase();
      if (TRUE_WORDS.has(value)) return { ok: true, value: true };
      if (FALSE_WORDS.has(value)) return { ok: true, value: false };
      return { ok: false, reason: `${attribute.key} is not true/false: "${String(raw)}"` };
    }
  }
}
