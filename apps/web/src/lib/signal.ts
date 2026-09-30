/**
 * A one-slot, payload-free pub/sub: one listener at a time, which the mounted
 * component claims and releases, and a `fire` that is a no-op while the slot is
 * empty. React-free, so a module that only fires never pulls the listener's
 * component into its bundle. `ingestion-bus` is the one.
 */
export function createSignal() {
  let listener: (() => void) | null = null;
  return {
    /** Claim the slot on mount, pass null to release it on unmount. */
    listen: (next: (() => void) | null): void => {
      listener = next;
    },
    fire: (): void => listener?.(),
  };
}
