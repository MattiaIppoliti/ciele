/** Separate conversational sessions, not individual messages. */
export function showMessageTimeSeparator(current?: string | null, previous?: string | null): boolean {
  if (!current) return false;
  const now = new Date(current);
  if (!Number.isFinite(now.getTime())) return false;
  if (!previous) return true;
  const before = new Date(previous);
  if (!Number.isFinite(before.getTime())) return true;
  return now.toDateString() !== before.toDateString() || now.getTime() - before.getTime() >= 2 * 60 * 60 * 1000;
}
