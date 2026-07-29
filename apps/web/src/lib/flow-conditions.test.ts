import { describe, expect, it } from "vitest";
import type { FlowCondition } from "@agent-hub/core";
import {
  availableFlowConditionKinds,
  cleanFlowConditions,
  FLOW_CONDITION_KINDS,
  FLOW_URL_OPERATORS,
  flowConditionDescription,
  flowConditionIssue,
  flowConditionPicker,
  flowConditionsSavable,
  newFlowCondition,
  timezoneOptions,
  urlOperatorHint,
} from "./flow-conditions";

/**
 * The Flow Builder's Conditions logic (spec #550). The component itself is a
 * `.tsx`, which this suite does not collect — so the pieces worth testing live
 * in the plain-TS module and are tested here.
 */

describe("flowConditionPicker", () => {
  it("offers Conversation context, URL and Schedule for a message trigger", () => {
    expect(availableFlowConditionKinds("message")).toEqual([
      "conversation_context",
      "url",
      "schedule",
    ]);
  });

  it("drops Conversation context for a trigger no message starts", () => {
    expect(availableFlowConditionKinds("page_load")).toEqual(["url", "schedule"]);
    expect(
      flowConditionPicker("page_load").some(
        (meta) => meta.kind === "conversation_context"
      )
    ).toBe(false);
  });

  // Kinds the runtime cannot evaluate are not offered at all — no greyed chip
  // for User role, External data or Course.
  it("offers no kind that cannot be evaluated", () => {
    expect(flowConditionPicker("message").map((m) => m.kind)).toEqual([
      "conversation_context",
      "url",
      "schedule",
    ]);
    for (const kind of ["user_role", "external_data", "course"]) {
      expect(FLOW_CONDITION_KINDS.some((meta) => meta.kind === kind)).toBe(false);
    }
  });

  it("labels every kind it offers", () => {
    for (const meta of flowConditionPicker("message")) {
      expect(meta.label.length).toBeGreaterThan(0);
    }
  });

  it("offers nothing until a trigger is chosen", () => {
    expect(availableFlowConditionKinds(null)).toEqual([]);
    expect(flowConditionPicker(null)).toEqual([]);
  });
});

describe("newFlowCondition", () => {
  it("seeds a URL condition on the exact-match operator", () => {
    expect(newFlowCondition("url", "c1")).toEqual({
      id: "c1",
      kind: "url",
      operator: "matches",
      value: "",
    });
  });

  it("seeds a Schedule condition in the given zone", () => {
    expect(newFlowCondition("schedule", "c1", "Europe/Rome")).toEqual({
      id: "c1",
      kind: "schedule",
      startAt: "",
      endAt: "",
      timezone: "Europe/Rome",
    });
  });

  it("seeds a Conversation context condition with one example of each polarity", () => {
    const condition = newFlowCondition("conversation_context", "c1");
    expect(condition.kind).toBe("conversation_context");
    if (condition.kind !== "conversation_context") return;
    expect(condition.examples.map((e) => e.shouldTrigger)).toEqual([true, false]);
  });
});

describe("flowConditionIssue", () => {
  it("reports the reference copy for a missing URL", () => {
    expect(flowConditionIssue(newFlowCondition("url", "c1"))).toBe(
      "URL is required"
    );
  });

  it("reports an uncompilable regular expression", () => {
    expect(
      flowConditionIssue({
        id: "c1",
        kind: "url",
        operator: "regex",
        value: "([unclosed",
      })
    ).toBe("Enter a valid regular expression");
  });

  it("reports a missing start and an end that is not after it", () => {
    expect(flowConditionIssue(newFlowCondition("schedule", "c1", "UTC"))).toBe(
      "Start date & time is required"
    );
    expect(
      flowConditionIssue({
        id: "c1",
        kind: "schedule",
        startAt: "2026-08-02T09:00",
        endAt: "2026-08-01T09:00",
        timezone: "UTC",
      })
    ).toBe("End must be after start");
  });

  it("passes a complete condition and anything semantic", () => {
    expect(
      flowConditionIssue({
        id: "c1",
        kind: "url",
        operator: "contains",
        value: "/courses",
      })
    ).toBeNull();
    expect(
      flowConditionIssue(newFlowCondition("conversation_context", "c1"))
    ).toBeNull();
  });
});

describe("flowConditionsSavable", () => {
  it("refuses a flow carrying an incomplete objective condition", () => {
    expect(flowConditionsSavable([newFlowCondition("url", "c1")])).toBe(false);
    expect(
      flowConditionsSavable([
        { id: "c1", kind: "url", operator: "matches", value: "https://x.test" },
        newFlowCondition("conversation_context", "c2"),
      ])
    ).toBe(true);
  });
});

describe("cleanFlowConditions", () => {
  it("trims a URL value and drops a blank end date", () => {
    const cleaned = cleanFlowConditions([
      { id: "c1", kind: "url", operator: "contains", value: "  /courses  " },
      {
        id: "c2",
        kind: "schedule",
        startAt: " 2026-08-01T09:00 ",
        endAt: "   ",
        timezone: "Europe/Rome",
      },
    ]);
    expect(cleaned[0]).toEqual({
      id: "c1",
      kind: "url",
      operator: "contains",
      value: "/courses",
    });
    expect(cleaned[1]).toEqual({
      id: "c2",
      kind: "schedule",
      startAt: "2026-08-01T09:00",
      endAt: undefined,
      timezone: "Europe/Rome",
    });
  });

  it("drops a Conversation context condition left entirely blank", () => {
    expect(
      cleanFlowConditions([newFlowCondition("conversation_context", "c1")])
    ).toEqual([]);
  });

  it("keeps a Conversation context condition that has a description or an example", () => {
    const conditions: FlowCondition[] = [
      {
        id: "c1",
        kind: "conversation_context",
        description: "  asks about fees  ",
        examples: [
          { message: " ", note: "", shouldTrigger: true },
          { message: "how much is tuition", note: "", shouldTrigger: true },
        ],
      },
    ];
    const [cleaned] = cleanFlowConditions(conditions);
    expect(cleaned.kind).toBe("conversation_context");
    if (cleaned.kind !== "conversation_context") return;
    expect(cleaned.description).toBe("asks about fees");
    expect(cleaned.examples).toHaveLength(1);
  });
});

describe("flowConditionDescription", () => {
  it("joins the semantic descriptions and ignores objective conditions", () => {
    expect(
      flowConditionDescription([
        {
          id: "c1",
          kind: "conversation_context",
          description: "asks about fees",
          examples: [],
        },
        { id: "c2", kind: "url", operator: "contains", value: "/courses" },
        {
          id: "c3",
          kind: "conversation_context",
          description: "mentions a deadline",
          examples: [],
        },
      ])
    ).toBe("asks about fees; mentions a deadline");
  });

  it("is empty for a flow gated only objectively", () => {
    expect(
      flowConditionDescription([
        { id: "c1", kind: "url", operator: "contains", value: "/courses" },
      ])
    ).toBe("");
  });
});

describe("urlOperatorHint", () => {
  it("explains the Matches/Contains difference with a worked example", () => {
    expect(urlOperatorHint("matches")).toContain("does not match");
    expect(urlOperatorHint("contains")).toContain("including subpages");
    expect(urlOperatorHint("regex")).toContain("regular expression");
  });

  it("has a hint for every operator", () => {
    expect(FLOW_URL_OPERATORS.map((o) => o.value)).toEqual([
      "matches",
      "contains",
      "regex",
    ]);
    for (const operator of FLOW_URL_OPERATORS) {
      expect(operator.hint.length).toBeGreaterThan(0);
    }
  });
});

describe("timezoneOptions", () => {
  it("labels zones with their offset at the given instant", () => {
    const summer = timezoneOptions(new Date("2026-08-01T12:00:00Z"));
    const rome = summer.find((zone) => zone.value === "Europe/Rome");
    expect(rome?.label).toBe("(GMT+2) Europe/Rome");

    const winter = timezoneOptions(new Date("2026-01-15T12:00:00Z"));
    expect(winter.find((zone) => zone.value === "Europe/Rome")?.label).toBe(
      "(GMT+1) Europe/Rome"
    );
  });

  it("never returns an empty list", () => {
    expect(timezoneOptions().length).toBeGreaterThan(0);
  });
});
