/**
 * Undo / Redo over a Flow draft (spec #836, ticket #837).
 *
 * The Flow Builder's two renderings, the form and the canvas, and the Flows
 * Agent all edit one `FlowDraft`; this is the one history they share. Pure and
 * generic over the draft type so it is testable through plain vitest, and so
 * the rule "typing in one field is one undo step, not one per keystroke" lives
 * here rather than in three components.
 *
 * Draft-only by decision (map #826): the history is cleared by navigation and
 * never persisted, Save is the Editor's act, and version history across saves
 * is not built.
 */

export interface DraftHistory<T> {
  past: T[];
  present: T;
  future: T[];
  /** The coalescing key of the last recorded edit, see `recordDraft`. */
  lastKey: string | null;
  /** When the last edit was recorded, for the coalescing window. */
  lastAt: number;
}

/** Older steps than this are dropped; a Flow never needs more. */
export const DRAFT_HISTORY_LIMIT = 100;

/**
 * Consecutive edits with the same key inside this window collapse into one
 * step, so a word typed into the name field undoes as a word.
 */
export const DRAFT_COALESCE_MS = 800;

export function createDraftHistory<T>(present: T): DraftHistory<T> {
  return { past: [], present, future: [], lastKey: null, lastAt: 0 };
}

export interface RecordOptions {
  /** Edits sharing a key within the window coalesce; omit for a discrete step. */
  key?: string;
  now?: number;
}

/**
 * Records a new present. Any redo future is discarded, as every editor does.
 * Returns the same history when `next` is the current present, so callers
 * can record unconditionally.
 */
export function recordDraft<T>(
  history: DraftHistory<T>,
  next: T,
  options: RecordOptions = {}
): DraftHistory<T> {
  if (Object.is(next, history.present)) return history;
  const now = options.now ?? Date.now();
  const key = options.key ?? null;
  const coalesce =
    key !== null &&
    key === history.lastKey &&
    now - history.lastAt <= DRAFT_COALESCE_MS &&
    history.past.length > 0;
  if (coalesce) {
    return { ...history, present: next, future: [], lastAt: now };
  }
  const past = [...history.past, history.present].slice(-DRAFT_HISTORY_LIMIT);
  return { past, present: next, future: [], lastKey: key, lastAt: now };
}

export function canUndo<T>(history: DraftHistory<T>): boolean {
  return history.past.length > 0;
}

export function canRedo<T>(history: DraftHistory<T>): boolean {
  return history.future.length > 0;
}

export function undoDraft<T>(history: DraftHistory<T>): DraftHistory<T> {
  if (!canUndo(history)) return history;
  const past = history.past.slice(0, -1);
  const present = history.past[history.past.length - 1]!;
  return {
    past,
    present,
    future: [history.present, ...history.future],
    // An undo ends any coalescing run: the next keystroke is a fresh step.
    lastKey: null,
    lastAt: 0,
  };
}

export function redoDraft<T>(history: DraftHistory<T>): DraftHistory<T> {
  if (!canRedo(history)) return history;
  const [present, ...future] = history.future as [T, ...T[]];
  return {
    past: [...history.past, history.present],
    present,
    future,
    lastKey: null,
    lastAt: 0,
  };
}
