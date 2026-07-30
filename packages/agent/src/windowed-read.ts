/**
 * Windowed reads (spec #559): the one primitive behind `readApiResponse` and
 * `readKnowledgeSource`. A payload too large to hand the model at once is kept
 * whole and read in character windows, each window carrying the **total
 * length** so the model can decide where to go next instead of being handed a
 * silently truncated chunk and no way to ask for more.
 *
 * Pure and clock-free. The retention of what is being read is the caller's
 * concern: an API response lives in the turn's in-memory handle store, a
 * knowledge document is re-read from the Db.
 */

/** Largest window one read may return, whatever the model asks for. */
export const MAX_READ_WINDOW_CHARS = 8_000;

export interface ReadWindow {
  /** Inclusive start offset actually read. */
  from: number;
  /** Exclusive end offset actually read. */
  to: number;
  totalLength: number;
  content: string;
  /**
   * Where the next window starts, or null at the end of the payload. Present
   * so the model never has to compute an offset (and so it cannot loop on the
   * same window believing there is more).
   */
  nextFrom: number | null;
  /** True when the requested range was wider than one window allows. */
  clamped: boolean;
}

/**
 * Reads `[from, to)` of `text`, clamped into the payload and to
 * {@link MAX_READ_WINDOW_CHARS}. Tolerates everything a model actually sends:
 * missing bounds (read from the start / to the window limit), a reversed range,
 * negatives, non-integers, and an offset past the end (which reads as an empty
 * window at the end rather than an error — there is genuinely nothing there).
 */
export function readWindow(
  text: string,
  from?: number | null,
  to?: number | null
): ReadWindow {
  const totalLength = text.length;
  const start = clampOffset(from, 0, totalLength);
  // An absent `to` means "one window from here", which is also the cap.
  const requestedEnd = clampOffset(to, totalLength, totalLength);
  const orderedEnd = Math.max(start, requestedEnd);
  const end = Math.min(orderedEnd, start + MAX_READ_WINDOW_CHARS);
  return {
    from: start,
    to: end,
    totalLength,
    content: text.slice(start, end),
    nextFrom: end < totalLength ? end : null,
    clamped: orderedEnd > end,
  };
}

function clampOffset(value: number | null | undefined, fallback: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (value == null || !Number.isFinite(parsed)) return Math.min(fallback, max);
  return Math.min(Math.max(Math.trunc(parsed), 0), max);
}

/**
 * The read's note to the model: how much of the payload it just saw and what to
 * do next. Written here rather than at each call site so the two windowed tools
 * cannot describe the same situation differently.
 */
export function readWindowNote(window: ReadWindow, subject: string): string {
  if (window.totalLength === 0) return `${subject} is empty.`;
  if (window.from === 0 && window.nextFrom === null) {
    return `Read all ${window.totalLength} characters of ${subject}.`;
  }
  if (window.nextFrom === null) {
    return `Read characters ${window.from}-${window.to} of ${window.totalLength} — this is the end of ${subject}.`;
  }
  return `Read characters ${window.from}-${window.to} of ${window.totalLength}. Read again from ${window.nextFrom} if you need more of ${subject}.`;
}
