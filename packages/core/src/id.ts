const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

let lastStamp = 0;

/**
 * A strictly-increasing wall-clock stamp (ms). Rows written in quick
 * succession (batch inserts, back-to-back calls in one process) get distinct,
 * ordered created_at values, so "newest first" and drop-oldest capping stay
 * deterministic where Postgres `now()` would tie within a statement.
 */
export function monotonicNow(): number {
  lastStamp = Math.max(lastStamp + 1, Date.now());
  return lastStamp;
}

/** Short public id in the style of "hAOzUt5m-cHI". */
export function shortId(length = 12): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += i === 8 ? "-" : ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}
