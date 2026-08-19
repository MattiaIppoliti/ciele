import { describe, expect, it } from "vitest";
import {
  FLOW_ACTION_PICKER,
  FLOW_ACTIONS,
  PROACTIVE_FLOW_ACTION_PICKER,
  actionsFitTrigger,
  partitionActionsForTrigger,
} from "./flow-actions";

/**
 * The trigger↔action pairing as the *editor* sees it. The server action refuses a
 * mismatched pair (it would be a runtime the UI forbids), so any pair the builder
 * can assemble and offer to save must already be valid, a 500 is not a validation
 * message.
 */
describe("partitionActionsForTrigger", () => {
  it("keeps a reactive action on the message trigger", () => {
    expect(
      partitionActionsForTrigger(["custom_message", "search_knowledge"], "message")
    ).toEqual({ kept: ["custom_message", "search_knowledge"], discarded: [] });
  });

  it("discards reactive actions when the trigger becomes proactive", () => {
    // The regression: a built-in flow carrying `custom_message` was posted on
    // chat_open because "Remove trigger" had already nulled the trigger, so the
    // editor's kind comparison saw no crossing and cleared nothing.
    expect(
      partitionActionsForTrigger(["custom_message"], "chat_open")
    ).toEqual({ kept: [], discarded: ["custom_message"] });
    expect(
      partitionActionsForTrigger(["notification"], "chat_open")
    ).toEqual({ kept: ["notification"], discarded: [] });
  });

  it("discards a notification when the trigger becomes a message", () => {
    expect(partitionActionsForTrigger(["notification"], "message")).toEqual({
      kept: [],
      discarded: ["notification"],
    });
  });

  it("treats every proactive trigger the same way", () => {
    for (const trigger of ["page_load", "time_on_page", "chat_open"] as const) {
      expect(
        partitionActionsForTrigger(["custom_message", "notification"], trigger)
      ).toEqual({ kept: ["notification"], discarded: ["custom_message"] });
    }
  });
});

describe("actionsFitTrigger", () => {
  it("is true while no trigger has been chosen", () => {
    expect(actionsFitTrigger(["custom_message"], null)).toBe(true);
  });

  it("gates the pair the builder would post", () => {
    expect(actionsFitTrigger(["custom_message"], "chat_open")).toBe(false);
    expect(actionsFitTrigger(["notification"], "chat_open")).toBe(true);
    expect(actionsFitTrigger(["notification"], "message")).toBe(false);
    expect(actionsFitTrigger([], "chat_open")).toBe(true);
  });
});

describe("the pickers only offer actions their trigger allows", () => {
  it("keeps notification out of the reactive picker", () => {
    expect(FLOW_ACTION_PICKER).not.toContain("notification");
    expect(actionsFitTrigger(FLOW_ACTION_PICKER, "message")).toBe(true);
  });

  it("offers only the notification for a proactive trigger", () => {
    expect(PROACTIVE_FLOW_ACTION_PICKER).toEqual(["notification"]);
    expect(actionsFitTrigger(PROACTIVE_FLOW_ACTION_PICKER, "page_load")).toBe(true);
  });

  it("keeps basic_reply out of the reactive picker but still describes it", () => {
    // It belongs to the built-in Basic Interaction flow, not to arbitrary flows:
    // "Message + Basic reply" has no coherent meaning. The metadata entry is
    // still required, the Flows list and the builder render the chip.
    expect(FLOW_ACTION_PICKER).not.toContain("basic_reply");
    expect(FLOW_ACTIONS.basic_reply.label).toBeTruthy();
  });

  it("describes every action it can offer", () => {
    for (const action of [...FLOW_ACTION_PICKER, ...PROACTIVE_FLOW_ACTION_PICKER]) {
      expect(FLOW_ACTIONS[action]?.label, action).toBeTruthy();
    }
  });
});
