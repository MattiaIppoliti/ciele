/**
 * The one preference this feature has: muted or not. Per device, beside the
 * theme, on one key shared by the marketing site and the console (same
 * origin). Not a database column: a Member's phone and desk are allowed to
 * differ, and there is nothing here an Organization administers.
 */
export const MUTE_STORAGE_KEY = "ciele.feedback";

export type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** Missing, unreadable or malformed means "not muted": the default is sound on. */
export function readMuted(storage: StorageLike | null | undefined): boolean {
  if (!storage) return false;
  try {
    const raw = storage.getItem(MUTE_STORAGE_KEY);
    if (!raw) return false;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return false;
    return (parsed as { muted?: unknown }).muted === true;
  } catch {
    return false;
  }
}

export function writeMuted(storage: StorageLike | null | undefined, muted: boolean): void {
  if (!storage) return;
  try {
    storage.setItem(MUTE_STORAGE_KEY, JSON.stringify({ muted }));
  } catch {
    // Private mode, quota, disabled storage: the choice still applies for the
    // session through state; it just does not survive the tab.
  }
}

/** Parse a `storage` event's new value the same way `readMuted` would. */
export function mutedFromStorageEvent(event: { key: string | null; newValue: string | null }): boolean | null {
  if (event.key !== MUTE_STORAGE_KEY) return null;
  return readMuted({ getItem: () => event.newValue, setItem: () => {} });
}
