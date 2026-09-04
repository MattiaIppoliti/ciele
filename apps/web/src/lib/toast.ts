import { toast as sonnerToast } from "sonner";
import { playFeedback, type Interaction } from "@agent-hub/ui/feedback";
import { publishNotification } from "@/lib/notification-bus";
import type { NotificationStatus } from "@/lib/notifications";

/**
 * Drop-in replacement for sonner's `toast` used across the admin UI. Inside the
 * admin shell the message lands in the bottom-right notification banner next to
 * operational alerts (one surface, one place to look); everywhere else, the
 * widget, sign-in, onboarding, it falls back to a sonner toast.
 *
 * Import this instead of `sonner` in anything that renders inside the shell.
 *
 * Outcomes also sound (#817): success and error each have a cue and, on a
 * phone, a haptic; warning has a cue. Info and loading are silent, they are
 * not outcomes. `playFeedback` is a no-op where no provider is mounted, which
 * is how the widget's toasts stay silent without a flag here.
 */

/** Which interaction a toast status is, or null for the statuses that are not outcomes. */
export function feedbackForStatus(status: NotificationStatus): Interaction | null {
  switch (status) {
    case "success":
      return "success";
    case "error":
      return "error";
    case "warning":
      return "warning";
    default:
      return null;
  }
}

function raise(status: NotificationStatus, message: string): void {
  const interaction = feedbackForStatus(status);
  if (interaction) playFeedback(interaction);
  if (publishNotification({ status, title: message })) return;
  sonnerToast[status](message);
}

export const toast = {
  success: (message: string) => raise("success", message),
  error: (message: string) => raise("error", message),
  warning: (message: string) => raise("warning", message),
  info: (message: string) => raise("info", message),
  /** Neutral notice, sonner's untyped `toast.message`. */
  message: (message: string) => raise("info", message),
};
