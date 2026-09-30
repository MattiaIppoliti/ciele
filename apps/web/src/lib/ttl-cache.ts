/**
 * A small read-through cache: a value is reused for `ttlMs`, callers that ask
 * while it is loading share the one load, a failure is never kept, and the
 * oldest entry goes when `max` is reached.
 *
 * For derived state whose record of truth is elsewhere and whose staleness can
 * be bounded in seconds: the Find palette's record list and previews. It is
 * per server instance, so it thins repeated reads and never claims to be one
 * shared truth. The caller owns the key and must put in it everything the value
 * depends on (Organization, Member), because the cache cannot know.
 */
export interface TtlCache<T> {
  /**
   * `keep` decides whether a loaded value is worth reusing. A value it rejects
   * (a partial answer, one that carries a degraded read) still goes to the
   * caller that asked but is not stored, so the next caller tries again.
   */
  wrap(key: string, load: () => Promise<T>, keep?: (value: T) => boolean): Promise<T>;
  /**
   * Drops every key that starts with `prefix`, and keeps a load already in
   * flight for one of them from storing what it read before the change.
   */
  expire(prefix: string): void;
}

export function createTtlCache<T>(options: {
  ttlMs: number;
  /** Most entries kept. Default 200. */
  max?: number;
  /** Clock, injectable for tests. */
  now?: () => number;
}): TtlCache<T> {
  const { ttlMs, max = 200, now = Date.now } = options;
  const values = new Map<string, { value: T; at: number }>();
  const inflight = new Map<string, Promise<T>>();

  return {
    wrap(key, load, keep) {
      const hit = values.get(key);
      if (hit && now() - hit.at < ttlMs) return Promise.resolve(hit.value);

      const pending = inflight.get(key);
      if (pending) return pending;

      // `Promise.resolve().then(load)`: a `load` that throws before it returns a
      // promise is a rejection, not an exception that leaves the key in flight.
      const started = Promise.resolve().then(load).then(
        (value) => {
          // An expiry while this was loading removed it from `inflight`: what it
          // read may predate the change, so it goes to its caller and no further.
          if (inflight.get(key) !== started) return value;
          inflight.delete(key);
          if (keep && !keep(value)) return value;
          values.delete(key); // re-insert so insertion order tracks age
          values.set(key, { value, at: now() });
          while (values.size > max) {
            values.delete(values.keys().next().value as string);
          }
          return value;
        },
        (error) => {
          if (inflight.get(key) === started) inflight.delete(key);
          throw error;
        }
      );
      inflight.set(key, started);
      return started;
    },
    expire(prefix) {
      for (const map of [values, inflight] as const) {
        for (const key of [...map.keys()]) if (key.startsWith(prefix)) map.delete(key);
      }
    },
  };
}
