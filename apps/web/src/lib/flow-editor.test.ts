import { describe, expect, it } from "vitest";
import type { FlowCondition } from "@agent-hub/core";
import { DEFAULT_DWELL_SECONDS } from "@agent-hub/core";

import {
  actionConfigured,
  applyTriggerChange,
  flowDraftStatus,
  flowSavePayload,
  initialDwell,
  triggerChangePlan,
  type FlowDraft,
} from "./flow-editor";

/**
 * The Flow Builder's editing engine, tested through its own interface: what a
 * draft may save, what a trigger change discards, and what payload a save
 * sends. The FlowBuilder component is a rendering adapter over this module.
 */

function draft(overrides: Partial<FlowDraft> = {}): FlowDraft {
  return {
    name: "Opening hours",
    trigger: "message",
    dwell: { minutes: 0, seconds: DEFAULT_DWELL_SECONDS },
    conditionLogic: "any",
    conditions: [],
    actions: ["search_knowledge"],
    settings: {},
    customMessage: "",
    ...overrides,
  };
}

const urlCondition = (url = "https://example.com/pricing"): FlowCondition => ({
  id: "c-url",
  kind: "url",
  operator: "contains",
  value: url,
});

describe("initialDwell", () => {
  it("defaults when the flow stores no dwell (or an all-zero one)", () => {
    expect(initialDwell(undefined)).toEqual({
      minutes: Math.floor(DEFAULT_DWELL_SECONDS / 60),
      seconds: DEFAULT_DWELL_SECONDS % 60,
    });
    expect(initialDwell({ timeOnPage: { minutes: 0, seconds: 0 } })).toEqual(
      initialDwell(undefined)
    );
  });

  it("normalizes a stored dwell into minutes + seconds", () => {
    expect(initialDwell({ timeOnPage: { minutes: 1, seconds: 90 } })).toEqual({
      minutes: 2,
      seconds: 30,
    });
  });
});

describe("flowDraftStatus", () => {
  it("accepts a complete reactive draft", () => {
    const status = flowDraftStatus(draft(), { isDefaultFlow: false, isEdit: false });
    expect(status.canSave).toBe(true);
    expect(status.disabledHint).toBeNull();
    expect(status.proactive).toBe(false);
  });

  it("refuses a zero dwell on time_on_page; it would shadow page_load", () => {
    const status = flowDraftStatus(
      draft({
        trigger: "time_on_page",
        actions: ["notification"],
        settings: { notification: { content: "Hi there" } },
        dwell: { minutes: 0, seconds: 0 },
      }),
      { isDefaultFlow: false, isEdit: false }
    );
    expect(status.dwellOk).toBe(false);
    expect(status.canSave).toBe(false);
    expect(status.disabledHint).toContain("stay on the page");
  });

  it("refuses an action the trigger cannot run, naming the offenders", () => {
    const status = flowDraftStatus(
      draft({ trigger: "chat_open", actions: ["custom_message"], customMessage: "hello" }),
      { isDefaultFlow: false, isEdit: false }
    );
    expect(status.actionsMatchTrigger).toBe(false);
    expect(status.canSave).toBe(false);
    expect(status.disabledHint).toContain("cannot run");
  });

  it("requires every added action to be configured", () => {
    const status = flowDraftStatus(
      draft({ actions: ["search_knowledge", "iframe"], settings: {} }),
      { isDefaultFlow: false, isEdit: false }
    );
    expect(status.configuredActions).toBe(false);
    expect(status.disabledHint).toBe(
      "Complete the required settings for every response action"
    );
  });

  it("refuses an incomplete objective condition before the runtime sees it", () => {
    const status = flowDraftStatus(
      draft({ conditions: [urlCondition("")] }),
      { isDefaultFlow: false, isEdit: false }
    );
    expect(status.conditionsOk).toBe(false);
    expect(status.disabledHint).toBe("Complete every condition you added");
  });

  it("gates on the name last, wording the hint by edit mode", () => {
    const create = flowDraftStatus(draft({ name: "  " }), {
      isDefaultFlow: false,
      isEdit: false,
    });
    expect(create.disabledHint).toBe("Name the flow to enable Create flow");
    const edit = flowDraftStatus(draft({ name: "  " }), {
      isDefaultFlow: false,
      isEdit: true,
    });
    expect(edit.disabledHint).toBe("Name the flow to enable Save changes");
  });

  it("needs no trigger on the Default behavior flow", () => {
    const status = flowDraftStatus(draft({ trigger: null }), {
      isDefaultFlow: true,
      isEdit: true,
    });
    expect(status.triggerOk).toBe(true);
    expect(status.canSave).toBe(true);
  });
});

describe("actionConfigured", () => {
  it("judges show_button by its selected type's required field", () => {
    expect(actionConfigured("show_button", {}, "")).toBe(false);
    expect(
      actionConfigured(
        "show_button",
        { show_button: { type: "help_desk", helpDeskId: "hd1" } },
        ""
      )
    ).toBe(true);
    expect(
      actionConfigured(
        "show_button",
        { show_button: { type: "send_text", text: " " } },
        ""
      )
    ).toBe(false);
  });

  it("requires at least one manual follow-up question in manual mode", () => {
    expect(
      actionConfigured(
        "follow_up_questions",
        { follow_up_questions: { mode: "manual", questions: [" ", ""] } },
        ""
      )
    ).toBe(false);
    expect(
      actionConfigured(
        "follow_up_questions",
        { follow_up_questions: { mode: "ai_generated" } },
        ""
      )
    ).toBe(true);
  });
});

describe("triggerChangePlan / applyTriggerChange", () => {
  it("asks the actions, not the previous trigger: a nulled trigger still plans a discard", () => {
    const d = draft({ trigger: null, actions: ["custom_message"], customMessage: "hi" });
    const plan = triggerChangePlan(d, "chat_open");
    expect(plan.needsConfirmation).toBe(true);
    expect(plan.discarded).toEqual(["custom_message"]);
  });

  it("crossing into proactive clears conditions, the custom message, and orphaned settings", () => {
    const d = draft({
      actions: ["custom_message"],
      customMessage: "verbatim",
      conditions: [urlCondition()],
      settings: { notification: { content: "stale" } },
    });
    const applied = applyTriggerChange(d, "page_load");
    expect(applied.trigger).toBe("page_load");
    expect(applied.actions).toEqual([]);
    expect(applied.conditions).toEqual([]);
    expect(applied.customMessage).toBe("");
    expect(applied.settings.notification).toBeUndefined();
  });

  it("a compatible change needs no confirmation and keeps everything", () => {
    const d = draft({ actions: ["search_knowledge"], conditions: [urlCondition()] });
    expect(triggerChangePlan(d, "message").needsConfirmation).toBe(false);
    const applied = applyTriggerChange(d, "message");
    expect(applied.actions).toEqual(["search_knowledge"]);
    expect(applied.conditions).toHaveLength(1);
  });
});

describe("flowSavePayload", () => {
  it("stores the dwell only for time_on_page, never a stale one", () => {
    const proactive = flowSavePayload(
      draft({
        trigger: "time_on_page",
        actions: ["notification"],
        settings: { notification: { content: "Hi" } },
        dwell: { minutes: 1, seconds: 30 },
      }),
      null
    );
    expect(proactive.triggerSettings).toEqual({
      timeOnPage: { minutes: 1, seconds: 30 },
    });
    const reactive = flowSavePayload(draft({ dwell: { minutes: 1, seconds: 30 } }), null);
    expect(reactive.triggerSettings).toEqual({});
  });

  it("regenerates the description from semantic conditions (classifier catalog sync)", () => {
    const payload = flowSavePayload(
      draft({
        conditions: [
          {
            id: "c-ctx",
            kind: "conversation_context",
            description: "  the visitor asks about pricing  ",
            examples: [],
          },
          // Objective conditions are gated, not prompted, they contribute nothing.
          urlCondition("pricing"),
        ],
      }),
      { description: "old description" }
    );
    expect(payload.description).toBe("the visitor asks about pricing");
  });

  it("keeps the existing description when no conditions describe the flow", () => {
    const payload = flowSavePayload(draft(), { description: "hand-written" });
    expect(payload.description).toBe("hand-written");
    expect(payload.trigger).toBe("message");
  });
});
