/**
 * One-slot pub/sub between the places that start knowledge work (the Library's
 * Add website, a re-crawl, an Import's "Sync now") and the mounted activity
 * card, so the card appears on the click rather than on whichever poll happens
 * next.
 *
 * It carries no payload on purpose. What started is the server's answer, and
 * the first poll is how the card learns it: an "Add website" has no Source id
 * to hand over yet, and a caller that guessed one would have to be kept
 * correct forever. The signal means "look now", nothing more.
 *
 * React-free, like `notification-bus`, so a component that only starts work
 * never pulls the card into its bundle.
 */

type Listener = () => void;

let listener: Listener | null = null;

/** The card claims the slot on mount and releases it on unmount. */
export function setIngestionListener(next: Listener | null): void {
  listener = next;
}

/** Tells the activity card that knowledge work just started. */
export function ingestionStarted(): void {
  listener?.();
}
