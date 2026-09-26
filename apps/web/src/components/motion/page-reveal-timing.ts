/**
 * When each block of a page starts its entrance. The gap shrinks as the count
 * grows so a long page never takes longer than `MAX_SPAN_MS` to finish
 * arriving: past that, the last block reads as late rather than as part of
 * one entrance.
 */
export const REVEAL_DURATION_MS = 700;
export const MAX_BLOCKS = 12;
const STEP_MS = 110;
const MAX_SPAN_MS = 800;

export function revealDelays(count: number, reduce: boolean): number[] {
  const n = Math.max(0, Math.min(count, MAX_BLOCKS));
  if (n === 0) return [];
  // Reduced motion keeps the order but compresses it: a fade, not a cascade.
  const step = reduce ? 25 : Math.min(STEP_MS, MAX_SPAN_MS / Math.max(1, n - 1));
  return Array.from({ length: n }, (_, i) => Math.round(i * step));
}
