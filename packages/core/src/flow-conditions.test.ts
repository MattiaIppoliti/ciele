import { describe, expect, it } from "vitest";
import {
  FLOW_URL_PATTERN_LIMIT,
  evaluateFlowCondition,
  flowConditionDefect,
  flowConditionsAllowRouting,
  isObjectiveFlowCondition,
} from "./flow-conditions";
import type { Flow, FlowCondition } from "./types";

/**
 * Objective Flow Conditions (spec #550). Pure throughout — the clock and the
 * page URL are parameters, so no test needs fake timers or a browser.
 */

function makeFlow(overrides: Partial<Flow> = {}): Flow {
  return {
    id: "flow-1",
    assistantId: "assistant-1",
    name: "Course help",
    description: "",
    builtIn: false,
    enabled: true,
    position: 1,
    trigger: "message",
    conditionLogic: "any",
    conditions: [],
    actions: ["custom_message"],
    actionSettings: {},
    customMessage: "",
    isDefault: false,
    ...overrides,
  };
}

function url(
  overrides: Partial<Extract<FlowCondition, { kind: "url" }>> = {}
): FlowCondition {
  return { id: "c-url", kind: "url", operator: "matches", value: "", ...overrides };
}

function schedule(
  overrides: Partial<Extract<FlowCondition, { kind: "schedule" }>> = {}
): FlowCondition {
  return {
    id: "c-schedule",
    kind: "schedule",
    startAt: "2026-08-01T09:00",
    timezone: "Europe/Rome",
    ...overrides,
  };
}

function context(overrides: Partial<FlowCondition> = {}): FlowCondition {
  return {
    id: "c-ctx",
    kind: "conversation_context",
    description: "asks about enrollment",
    examples: [],
    ...overrides,
  } as FlowCondition;
}

describe("isObjectiveFlowCondition", () => {
  it("separates the gated kinds from the judged one", () => {
    expect(isObjectiveFlowCondition(url({ value: "/x" }))).toBe(true);
    expect(isObjectiveFlowCondition(schedule())).toBe(true);
    expect(isObjectiveFlowCondition(context())).toBe(false);
  });
});

describe("evaluateFlowCondition — URL", () => {
  const page = "https://site.com/courses?term=autumn";

  it("matches on the entire URL including the query string", () => {
    expect(
      evaluateFlowCondition(url({ operator: "matches", value: page }), {
        url: page,
      })
    ).toBe(true);
  });

  it("does not match a different query string or a deeper path", () => {
    expect(
      evaluateFlowCondition(
        url({ operator: "matches", value: "https://site.com/courses" }),
        { url: page }
      )
    ).toBe(false);
    expect(
      evaluateFlowCondition(
        url({ operator: "matches", value: "https://site.com/courses" }),
        { url: "https://site.com/courses/psychology" }
      )
    ).toBe(false);
  });

  it("contains matches a section and its subpages", () => {
    const condition = url({ operator: "contains", value: "/courses" });
    expect(evaluateFlowCondition(condition, { url: page })).toBe(true);
    expect(
      evaluateFlowCondition(condition, {
        url: "https://site.com/courses/psychology",
      })
    ).toBe(true);
    expect(
      evaluateFlowCondition(condition, { url: "https://site.com/admissions" })
    ).toBe(false);
  });

  it("applies a regex to the whole URL", () => {
    const condition = url({ operator: "regex", value: ".*/courses/.*" });
    expect(
      evaluateFlowCondition(condition, {
        url: "https://site.com/courses/psychology",
      })
    ).toBe(true);
    expect(evaluateFlowCondition(condition, { url: page })).toBe(false);
  });

  it("gives no verdict for a regex that does not compile", () => {
    expect(
      evaluateFlowCondition(url({ operator: "regex", value: "([unclosed" }), {
        url: page,
      })
    ).toBeNull();
  });

  it("gives no verdict when the value is blank or over the length cap", () => {
    expect(evaluateFlowCondition(url({ value: "" }), { url: page })).toBeNull();
    expect(
      evaluateFlowCondition(
        url({ operator: "contains", value: "x".repeat(FLOW_URL_PATTERN_LIMIT + 1) }),
        { url: page }
      )
    ).toBeNull();
  });

  it("gives no verdict when the context carries no page URL", () => {
    expect(evaluateFlowCondition(url({ value: page }), {})).toBeNull();
  });
});

describe("evaluateFlowCondition — Schedule", () => {
  // 09:00–18:00 Europe/Rome on 1 August 2026 (CEST, UTC+2).
  const summer = schedule({ startAt: "2026-08-01T09:00", endAt: "2026-08-01T18:00" });

  it("is closed before the start and open inside the window", () => {
    expect(
      evaluateFlowCondition(summer, { now: new Date("2026-08-01T06:30:00Z") })
    ).toBe(false);
    expect(
      evaluateFlowCondition(summer, { now: new Date("2026-08-01T07:30:00Z") })
    ).toBe(true);
  });

  it("is closed at and after the end", () => {
    expect(
      evaluateFlowCondition(summer, { now: new Date("2026-08-01T16:00:00Z") })
    ).toBe(false);
  });

  it("opens exactly at the start", () => {
    expect(
      evaluateFlowCondition(summer, { now: new Date("2026-08-01T07:00:00Z") })
    ).toBe(true);
  });

  it("keeps its wall-clock meaning across a daylight-saving change", () => {
    // Same 09:00 wall clock, but January in Rome is CET (UTC+1). 08:30Z is
    // 09:30 local and must be inside; 07:30Z is 08:30 local and must not.
    const winter = schedule({
      startAt: "2026-01-15T09:00",
      endAt: "2026-01-15T18:00",
    });
    expect(
      evaluateFlowCondition(winter, { now: new Date("2026-01-15T08:30:00Z") })
    ).toBe(true);
    expect(
      evaluateFlowCondition(winter, { now: new Date("2026-01-15T07:30:00Z") })
    ).toBe(false);
  });

  it("reads the window in the condition's own zone, not the host's", () => {
    const tokyo = schedule({
      startAt: "2026-08-01T09:00",
      endAt: "2026-08-01T18:00",
      timezone: "Asia/Tokyo",
    });
    // 03:00Z is 12:00 in Tokyo (open) but 05:00 in Rome (closed).
    expect(
      evaluateFlowCondition(tokyo, { now: new Date("2026-08-01T03:00:00Z") })
    ).toBe(true);
    expect(
      evaluateFlowCondition(summer, { now: new Date("2026-08-01T03:00:00Z") })
    ).toBe(false);
  });

  it("leaves the window open-ended when the end is blank", () => {
    const openEnded = schedule({ startAt: "2026-08-01T09:00", endAt: "" });
    expect(
      evaluateFlowCondition(openEnded, { now: new Date("2030-01-01T00:00:00Z") })
    ).toBe(true);
  });

  it("gives no verdict without a clock, or with an unparseable start", () => {
    expect(evaluateFlowCondition(summer, {})).toBeNull();
    expect(
      evaluateFlowCondition(schedule({ startAt: "not a date" }), {
        now: new Date("2026-08-01T07:30:00Z"),
      })
    ).toBeNull();
  });

  it("tolerates a stored bound carrying seconds or a space separator", () => {
    const loose = schedule({
      startAt: "2026-08-01 09:00:00",
      endAt: "2026-08-01 18:00:00",
    });
    expect(
      evaluateFlowCondition(loose, { now: new Date("2026-08-01T07:30:00Z") })
    ).toBe(true);
  });
});

describe("flowConditionDefect", () => {
  it("names what is missing", () => {
    expect(flowConditionDefect(url({ value: "  " }))).toBe("url_value_missing");
    expect(flowConditionDefect(url({ operator: "regex", value: "([" }))).toBe(
      "url_regex_invalid"
    );
    expect(flowConditionDefect(schedule({ startAt: "" }))).toBe(
      "schedule_start_missing"
    );
    expect(flowConditionDefect(schedule({ startAt: "yesterday" }))).toBe(
      "schedule_start_invalid"
    );
    expect(flowConditionDefect(schedule({ endAt: "whenever" }))).toBe(
      "schedule_end_invalid"
    );
    expect(
      flowConditionDefect(
        schedule({ startAt: "2026-08-01T09:00", endAt: "2026-08-01T09:00" })
      )
    ).toBe("schedule_end_before_start");
  });

  it("passes a complete condition and anything semantic", () => {
    expect(flowConditionDefect(url({ value: "/courses" }))).toBeNull();
    expect(flowConditionDefect(schedule({ endAt: "2026-08-02T09:00" }))).toBeNull();
    expect(flowConditionDefect(context())).toBeNull();
  });
});

describe("flowConditionsAllowRouting", () => {
  const page = "https://site.com/courses";

  it("allows a flow with no conditions", () => {
    expect(flowConditionsAllowRouting(makeFlow(), { url: page })).toBe(true);
  });

  it("allows a flow whose objective condition is satisfied", () => {
    const flow = makeFlow({ conditions: [url({ value: page })] });
    expect(flowConditionsAllowRouting(flow, { url: page })).toBe(true);
  });

  it("disqualifies a flow whose only condition is objective and false", () => {
    const flow = makeFlow({ conditions: [url({ value: page })] });
    expect(
      flowConditionsAllowRouting(flow, { url: "https://site.com/admissions" })
    ).toBe(false);
  });

  it("disqualifies on one false objective condition under all logic", () => {
    const flow = makeFlow({
      conditionLogic: "all",
      conditions: [context(), url({ value: page })],
    });
    expect(flowConditionsAllowRouting(flow, { url: page })).toBe(true);
    expect(
      flowConditionsAllowRouting(flow, { url: "https://site.com/admissions" })
    ).toBe(false);
  });

  it("keeps a flow eligible under any logic when a semantic condition could still match", () => {
    const flow = makeFlow({
      conditionLogic: "any",
      conditions: [context(), url({ value: page })],
    });
    expect(
      flowConditionsAllowRouting(flow, { url: "https://site.com/admissions" })
    ).toBe(true);
  });

  it("disqualifies under any logic only when every condition produced a false verdict", () => {
    const flow = makeFlow({
      conditionLogic: "any",
      conditions: [
        url({ value: page }),
        schedule({ startAt: "2026-08-01T09:00", endAt: "2026-08-01T18:00" }),
      ],
    });
    const outside = {
      url: "https://site.com/admissions",
      now: new Date("2026-08-02T07:30:00Z"),
    };
    expect(flowConditionsAllowRouting(flow, outside)).toBe(false);
    // One of the two true is enough under `any`.
    expect(flowConditionsAllowRouting(flow, { ...outside, url: page })).toBe(true);
  });

  it("never disqualifies without a routing context", () => {
    const flow = makeFlow({
      conditionLogic: "all",
      conditions: [url({ value: page }), schedule()],
    });
    expect(flowConditionsAllowRouting(flow)).toBe(true);
  });

  it("ignores a defective condition instead of failing closed", () => {
    const flow = makeFlow({
      conditionLogic: "all",
      conditions: [url({ operator: "regex", value: "([unclosed" })],
    });
    expect(flowConditionsAllowRouting(flow, { url: page })).toBe(true);
  });
});
