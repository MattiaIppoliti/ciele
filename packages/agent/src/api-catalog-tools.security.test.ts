import { describe, expect, it } from "vitest";
import type { RuntimeEvent } from "./types";
import {
  EMPTY_TURN_TRACE,
  foldTraceEvent,
  publicRuntimeEvent,
} from "./stream";

/**
 * The two-tier containment on a tool's structured result.
 *
 * A published widget returns the RuntimeEvent stream verbatim to an anonymous
 * Visitor, so `queryApi`'s upstream response body and its absolute request URL,
 * which name the org's own API host, must not ride on the wire. They stay on
 * `operatorResult`, which `turn.ts` strips on the way out and the stored trace
 * keeps. A failure here is a security regression.
 */
describe("tool-end result tiers", () => {
  const event = {
    type: "tool-end" as const,
    callId: "call-1",
    tool: "queryApi",
    ok: true,
    result: {
      endpoint: "Ticket comments",
      method: "GET",
      path: "/tickets/8317/comments",
      status: 200,
      ok: true,
      totalLength: 42,
    },
    operatorResult: {
      endpoint: "Ticket comments",
      method: "GET",
      path: "https://crm.internal.example.com/api/tickets/8317/comments",
      status: 200,
      ok: true,
      response: '{"secret":"other customers"}',
      totalLength: 42,
    },
    durationMs: 5,
  };

  it("strips the operator tier from the event a client receives", () => {
    const wire = publicRuntimeEvent(event);
    const serialized = JSON.stringify(wire);
    expect(wire).not.toHaveProperty("operatorResult");
    expect(serialized).not.toContain("other customers");
    expect(serialized).not.toContain("crm.internal.example.com");
    // The visitor-safe rows survive: the panel still shows the call happened.
    expect((wire as typeof event).result).toMatchObject({
      endpoint: "Ticket comments",
      status: 200,
    });
  });

  it("keeps the operator tier in the folded trace the Inbox renders", () => {
    const started = foldTraceEvent(EMPTY_TURN_TRACE, {
      type: "tool-start",
      callId: "call-1",
      tool: "queryApi",
      label: "Querying the API",
    } as RuntimeEvent);
    const trace = foldTraceEvent(started, event);
    const step = trace.steps.find((s) => s.id === "call-1");
    expect(step?.result).toMatchObject({
      response: '{"secret":"other customers"}',
      path: "https://crm.internal.example.com/api/tickets/8317/comments",
    });
  });

  it("leaves an event with no operator tier untouched", () => {
    const plain = {
      type: "tool-end" as const,
      callId: "c",
      tool: "searchKnowledge",
      ok: true,
      result: { hits: 3 },
      durationMs: 1,
    };
    expect(publicRuntimeEvent(plain)).toBe(plain);
  });
});

/**
 * The same two-tier rule for a `notice`. The Connector handler's own contract
 * is "any failure reads the configured failure message, never the provider's
 * error", and it held for the reply part while the raw provider error went out
 * as a notice label — which the widget chat route returns verbatim to an
 * anonymous Visitor and the Thinking panel renders. ServiceNow and Salesforce
 * say plenty about an Organization in a failure.
 */
describe("notice operator tier", () => {
  const notice = {
    type: "notice" as const,
    label: "ServiceNow request failed",
    operatorDetail:
      "401 Unauthorized: user 'svc_ciele' lacks role itil on instance acme-prod.service-now.com",
  };

  it("strips the operator detail from the event a Visitor receives", () => {
    const wire = publicRuntimeEvent(notice as RuntimeEvent);
    const serialized = JSON.stringify(wire);
    expect(wire).not.toHaveProperty("operatorDetail");
    expect(serialized).not.toContain("acme-prod.service-now.com");
    expect(serialized).not.toContain("svc_ciele");
    // The Visitor still learns the step happened and failed.
    expect((wire as typeof notice).label).toBe("ServiceNow request failed");
  });

  it("keeps it in the folded trace the Inbox renders", () => {
    const trace = foldTraceEvent(EMPTY_TURN_TRACE, notice as RuntimeEvent);
    expect(trace.steps[0]?.detail).toContain("svc_ciele");
  });

  it("leaves a notice with no operator tier untouched", () => {
    const plain = { type: "notice" as const, label: "Calling ServiceNow" };
    expect(publicRuntimeEvent(plain)).toBe(plain);
  });
});
