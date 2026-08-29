import { toast as sonnerToast } from "sonner";
import { publishNotification } from "@/lib/notification-bus";
import type { NotificationStatus } from "@/lib/notifications";

/**
 * Drop-in replacement for sonner's `toast` used across the admin UI. Inside the
 * admin shell the message lands in the bottom-right notification banner next to
 * operational alerts (one surface, one place to look); everywhere else, the
 * widget, sign-in, onboarding, it falls back to a sonner toast.
 *
 * Import this instead of `sonner` in anything that renders inside the shell.
 */

function raise(status: NotificationStatus, message: string): void {
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
