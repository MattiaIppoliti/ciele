// Deterministic, locale- and timezone-independent date formatting. Using
// toLocaleDateString/toLocaleString drifts between the server (Node locale/TZ)
// and the browser (user locale/TZ), which triggers React hydration mismatches.
// These format in UTC with fixed month names so SSR and client always agree.

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]

const p2 = (n: number) => String(n).padStart(2, "0")

/** "03 Jul 2026". */
export function formatDay(iso: string): string {
  const d = new Date(iso)
  return `${p2(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/** "03 Jul 26 07:44". */
export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return `${p2(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${String(
    d.getUTCFullYear()
  ).slice(2)} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`
}
