import type { Improvement } from "./types";

/**
 * An Improvement is open while it is neither done nor archived.
 *
 * A closed item is a solved problem, so a recurrence deserves a fresh item
 * rather than silently reopening history. The rule lived inline in two dedup
 * walks before it lived here; a pure function of a domain type belongs in the
 * domain package (ADR-0019).
 */
export function isOpenImprovement(improvement: Improvement): boolean {
  return improvement.status !== "done" && improvement.status !== "archived";
}
