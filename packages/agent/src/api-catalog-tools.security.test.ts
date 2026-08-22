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
