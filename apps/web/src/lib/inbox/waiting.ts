/** "Waiting 3 min" for the Inbox Waiting view (#1083); under a minute reads as "just now". */
export function waitedLabel(waitedMs: number): string {
  const minutes = Math.floor(Math.max(0, waitedMs) / 60_000);
  if (minutes < 1) return "Waiting less than a minute";
  if (minutes < 60) return `Waiting ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `Waiting ${hours} h ${minutes % 60} min`;
}
