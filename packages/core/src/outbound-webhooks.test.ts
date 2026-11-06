import { describe, expect, it } from "vitest";
import {
  OUTBOUND_WEBHOOK_EVENTS, OUTBOUND_WEBHOOK_EXAMPLES,
  isOutboundWebhookEvent, isOutboundWebhookEventType, outboundWebhookRetryAt,
} from "./outbound-webhooks";

const createdAt = "2026-10-22T10:00:00.000Z";

describe("outbound webhook event contract", () => {
  for (const [type, data] of Object.entries(OUTBOUND_WEBHOOK_EXAMPLES)) {
    it(`accepts the ${type} sample and refuses extra Visitor content`, () => {
      const event = { id: "event-example", type, createdAt, organizationId: "org-example", data };
      expect(isOutboundWebhookEvent(event)).toBe(true);
      expect(isOutboundWebhookEvent({ ...event, data: { ...data, messageText: "Visitor's private message" } })).toBe(false);
      expect(isOutboundWebhookEvent({ ...event, data: { ...data, formValues: { email: "visitor@example.com" } } })).toBe(false);
      expect(isOutboundWebhookEvent({ ...event, transcript: "Visitor's private message" })).toBe(false);
    });
  }

  it("covers every declared event and refuses missing or incorrectly typed data", () => {
    expect(Object.keys(OUTBOUND_WEBHOOK_EXAMPLES)).toEqual(Object.keys(OUTBOUND_WEBHOOK_EVENTS));
    const event = { id: "e1", type: "publication.created", createdAt, organizationId: "o1", data: OUTBOUND_WEBHOOK_EXAMPLES["publication.created"] };
    expect(isOutboundWebhookEvent({ ...event, data: { ...event.data, version: "2" } })).toBe(false);
    expect(isOutboundWebhookEvent({ ...event, data: { assistantId: "a1", version: 2 } })).toBe(false);
    expect(isOutboundWebhookEvent({ ...event, createdAt: "invalid" })).toBe(false);
    expect(isOutboundWebhookEventType("__proto__")).toBe(false);
    expect(isOutboundWebhookEvent({ ...event, type: "unknown" })).toBe(false);
    expect(isOutboundWebhookEvent({ ...event, type: "improvement.created", data: { ...OUTBOUND_WEBHOOK_EXAMPLES["improvement.created"], source: "unknown" } })).toBe(false);
  });
});

describe("outbound webhook retry schedule", () => {
  it("doubles the delay up to an hour and stops within 24 hours", () => {
    const now = new Date(createdAt);
    expect(outboundWebhookRetryAt(createdAt, 1, now)?.toISOString()).toBe("2026-10-22T10:01:00.000Z");
    expect(outboundWebhookRetryAt(createdAt, 2, now)?.toISOString()).toBe("2026-10-22T10:02:00.000Z");
    expect(outboundWebhookRetryAt(createdAt, 7, now)?.toISOString()).toBe("2026-10-22T11:00:00.000Z");
    expect(outboundWebhookRetryAt(createdAt, 30, new Date("2026-10-23T09:00:00Z"))).toBeNull();
    expect(outboundWebhookRetryAt(createdAt, 1, new Date("2026-10-23T10:00:00Z"))).toBeNull();
  });
});
