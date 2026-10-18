import { describe, expect, it } from "vitest";
import { flowActionSteps } from "./flow-actions";

describe("flowActionSteps", () => {
  it("retains legacy settings and assigns distinct stable canvas identities", () => {
    const steps = flowActionSteps({
      actions: ["custom_message", "custom_message", "show_button"],
      actionSettings: { show_button: { label: "Continue" } },
      customMessage: "Hello",
    });
    expect(steps.map(step => step.id)).toEqual(["action:custom_message", "action:custom_message:1", "action:show_button"]);
    expect(steps[1]?.customMessage).toBe("Hello");
    expect(steps[2]?.settings.show_button?.label).toBe("Continue");
  });

  it("does not let a mismatched stored occurrence change the authoritative action", () => {
    const steps = flowActionSteps({ actions: ["custom_message"], actionSettings: { steps: [
      { id: "invalid", action: "api_request", settings: { api_request: { url: "https://example.com" } } },
    ] }, customMessage: "Hello" });
    expect(steps[0]?.action).toBe("custom_message");
    expect(steps[0]?.id).toBe("action:custom_message");
  });
});
