import type { RuntimeEvent } from "@agent-hub/agent/client";
import type { Interaction } from "@agent-hub/ui/feedback";

/**
 * Which interface cue a chat stream event deserves (#817), for the console's
 * chat surfaces: the Assistant Preview, a Teammate's chat and a channel.
 *
 * Lifecycle events only, never tokens: a finished tool card ticks, a finished
 * reply bubbles, a failed turn sounds like a failed toast. Text deltas, tool
 * arguments and trace steps are the streaming itself and stay silent, which
 * is what keeps a long answer from becoming a drum roll.
 */
export function chatFeedbackForEvent(event: RuntimeEvent): Interaction | null {
  switch (event.type) {
    case "tool-end":
      return "complete";
    case "done":
      return "reply";
    case "error":
      return "error";
    default:
      return null;
  }
}
