import { findMemberKey } from "./find-index";

/**
 * The Find palette's recent searches (#1072): the last five queries a Member
 * opened something from, newest first, kept in this browser per Organization
 * and Member. A convenience, so storage that is missing or refuses is simply
 * an empty list.
 */
export const RECENT_SEARCH_LIMIT = 5;

/** The list after a query was used: moved to the front, never duplicated, capped. */
export function pushRecentSearch(list: readonly string[], query: string, limit = RECENT_SEARCH_LIMIT): string[] {
  const value = query.trim();
  if (!value) return [...list];
  return [value, ...list.filter((entry) => entry.toLowerCase() !== value.toLowerCase())].slice(0, limit);
}

// Keyed by Organization and Member (#1072), never by Role: a promotion must
// not wipe the list.
const storageKey = (scope: string) => `ciele.find.recent:${findMemberKey(scope)}`;

export function readRecentSearches(scope: string): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey(scope)) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string").slice(0, RECENT_SEARCH_LIMIT) : [];
  } catch {
    return [];
  }
}

export function writeRecentSearches(scope: string, list: readonly string[]): void {
  try {
    window.localStorage.setItem(storageKey(scope), JSON.stringify(list));
  } catch {
    // Private mode or a full quota: the palette just forgets.
  }
}
