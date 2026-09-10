import { describe, expect, it } from "vitest";
import type { FlowInput } from "@agent-hub/core";
import { flowInputSchema, flowPatchSchema } from "./flow-schema";

/**
 * The Flow schema is structural now (#837): a model or a script that sends a
 * Flow gets every field checked by name and type, and a newer build's extra
 * keys survive an older client's patch.
 */

const full: FlowInput = {
  name: "Refunds",
  description: "A student asks about a refund",
  trigger: "message",
  triggerSettings: {},
  conditionLogic: "all",
  conditions: [
    {
      id: "c1",
      kind: "conversation_context",
      description: "refund questions",
      examples: [{ message: "Can I get my money back?", note: "", shouldTrigger: true }],
    },
    { id: "c2", kind: "url", operator: "contains", value: "/fees" },
    { id: "c3", kind: "schedule", startAt: "2026-09-01T09:00", timezone: "Europe/Rome" },
  ],
  actions: ["search_knowledge", "show_button", "api_request"],
  actionSettings: {
    search_knowledge: { escalatePrompt: true },
    show_button: { type: "external_link", url: "https://example.edu/fees", label: "Fees" },
    api_request: {
      method: "POST",
      url: "https://api.example.edu/refunds",
      auth: { type: "bearer", hasToken: true },
      headers: [{ id: "h1", name: "X-Org", value: "acme" }],
      jsonPaths: [{ id: "j1", path: "$.id", variable: "refundId" }],
    },
  },
  customMessage: "",
};

describe("flow input schema", () => {
  it("accepts a fully configured Flow and returns it unchanged", () => {
    expect(flowInputSchema.parse(full)).toEqual(full);
  });

  it("accepts the minimal input the create form sends", () => {
    expect(flowInputSchema.parse({ name: "Hello" })).toEqual({ name: "Hello" });
  });

  it("rejects an unknown trigger, action or condition kind", () => {
    expect(flowInputSchema.safeParse({ name: "x", trigger: "on_scroll" }).success).toBe(false);
    expect(flowInputSchema.safeParse({ name: "x", actions: ["teleport"] }).success).toBe(false);
    expect(
      flowInputSchema.safeParse({
        name: "x",
        conditions: [{ id: "c", kind: "user_role", role: "student" }],
      }).success
    ).toBe(false);
  });

  it("rejects a mistyped setting instead of trusting the shape", () => {
    expect(
      flowInputSchema.safeParse({
        name: "x",
        actionSettings: { iframe: { height: "tall" } },
      }).success
    ).toBe(false);
    expect(
      flowInputSchema.safeParse({
        name: "x",
        actionSettings: { api_request: { method: "FETCH" } },
      }).success
    ).toBe(false);
    expect(
      flowInputSchema.safeParse({
        name: "x",
        triggerSettings: { timeOnPage: { minutes: -1 } },
      }).success
    ).toBe(false);
  });

  it("keeps keys it does not know about", () => {
    const parsed = flowInputSchema.parse({
      name: "x",
      actionSettings: { search_knowledge: { escalatePrompt: true, futureKnob: 3 } },
    });
    expect(
      (parsed.actionSettings?.search_knowledge as Record<string, unknown>).futureKnob
    ).toBe(3);
  });

  it("patches are partial and accept enabled", () => {
    expect(flowPatchSchema.parse({ enabled: false })).toEqual({ enabled: false });
    expect(flowPatchSchema.safeParse({ trigger: "nope" }).success).toBe(false);
  });
});

describe("the webhook's calls and the Response's status", () => {
  it("accepts a credential and headers on a webhook call, and the subscribe reply's paths", () => {
    const parsed = flowInputSchema.parse({
      name: "Subscribe",
      actions: ["http_webhook"],
      actionSettings: {
        http_webhook: {
          subscribe: {
            method: "POST",
            url: "https://api.example.com/subscriptions",
            auth: { type: "api_key", header: "X-API-Key", key: "k" },
            headers: [{ id: "h1", name: "X-Tenant", value: "t" }],
            jsonPaths: [{ id: "j1", path: "$.id", variable: "subscriptionId" }],
          },
          unsubscribe: {
            method: "DELETE",
            url: "https://api.example.com/subscriptions/{{subscriptionId}}",
            auth: { type: "bearer", token: "b" },
          },
        },
      },
    });
    expect(parsed.actionSettings?.http_webhook?.subscribe?.auth).toEqual({
      type: "api_key",
      header: "X-API-Key",
      key: "k",
    });
    expect(parsed.actionSettings?.http_webhook?.unsubscribe?.url).toContain("{{subscriptionId}}");
  });

  it("refuses a Response status below 200: not a final answer", () => {
    expect(() =>
      flowInputSchema.parse({
        name: "Answer",
        trigger: "http_request",
        actions: ["respond"],
        actionSettings: { respond: { status: 150 } },
      })
    ).toThrow();
    expect(
      flowInputSchema.parse({
        name: "Answer",
        trigger: "http_request",
        actions: ["respond"],
        actionSettings: { respond: { status: 204 } },
      }).actionSettings?.respond?.status
    ).toBe(204);
  });
});
