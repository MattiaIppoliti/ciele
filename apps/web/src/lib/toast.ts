import { playFeedback, type Interaction } from "@agent-hub/ui/feedback";
import type { NotificationStatus } from "@/lib/notifications";
import { emitToast, type ToastAction, type ToastInput } from "@/lib/toast-events";

export type { ToastAction, ToastInput } from "@/lib/toast-events";

/**
 * Shared feedback entry point for the whole web app. The root layout mounts
 * the animated toast stack, so admin, widget, auth and marketing surfaces all
 * use one visual treatment.
 *
 * Import this instead of a toast library in UI components.
 *
 * Outcomes also sound (#817): success and error each have a cue and, on a
 * phone, a haptic; warning has a cue. Info and pending are silent. The feedback
 * call is a no-op on routes without a FeedbackProvider.
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
  emitToast({ message, state: status });
}

/**
 * The button on an Undo toast (#1074). `revert` runs at most once, however
 * often the button is pressed before the toast leaves, and a refusal reaches
 * the Member as an error: the work actions answer `{ ok: false, error }`
 * rather than throwing, so a failed undo would otherwise pass in silence and
 * leave them believing it worked.
 */
export function undoAction(revert: () => unknown, onError: (message: string) => void): ToastAction {
  let used = false;
  return {
    label: "Undo",
    run: () => {
      if (used) return;
      used = true;
      void Promise.resolve()
        .then(revert)
        .then(
          (result) => {
            if (result && typeof result === "object" && "ok" in result && result.ok === false) {
              const error = "error" in result && typeof result.error === "string" ? result.error : null;
              onError(error ?? "Could not undo");
            }
          },
          (error: unknown) => onError(error instanceof Error ? error.message : "Could not undo")
        );
    },
  };
}

export const toast = {
  success: (message: string) => raise("success", message),
  error: (message: string) => raise("error", message),
  warning: (message: string) => raise("warning", message),
  info: (message: string) => raise("info", message),
  /**
   * Something done that can be taken back: archived, completed, deleted
   * within a restore window (#1074). A success toast whose button runs
   * `revert`, up for the action lifetime.
   */
  undo: (message: string, revert: () => unknown) => {
    playFeedback("success");
    return emitToast({
      message,
      state: "success",
      action: undoAction(revert, (error) => raise("error", error)),
    });
  },
  /** Full control for pending messages, action buttons, and custom lifetimes. */
  show: (input: string | ToastInput) => {
    const state = typeof input === "string" ? undefined : input.state;
    const interaction = state ? feedbackForStatus(state === "pending" ? "info" : state) : null;
    if (interaction) playFeedback(interaction);
    return emitToast(input);
  },
};
