import type { NotificationStatus } from "@/lib/notifications";

/**
 * One-slot pub/sub between the `toast` façade (`@/lib/toast`, callable from any
 * event handler) and the mounted notification banner. Kept React-free so the
 * façade never drags the admin banner into bundles that don't render it — and
 * so anything raised while no banner is mounted (the widget, sign-in) can fall
 * back to a plain toast.
 */

export interface NotificationInput {
  status: NotificationStatus;
  title: string;
  description?: string;
}

type Listener = (input: NotificationInput) => void;

let listener: Listener | null = null;

/** The banner claims the slot on mount and releases it on unmount. */
export function setNotificationListener(next: Listener | null): void {
  listener = next;
}

/** Returns false when no banner is mounted, so the caller can fall back. */
export function publishNotification(input: NotificationInput): boolean {
  if (!listener) return false;
  listener(input);
  return true;
}
