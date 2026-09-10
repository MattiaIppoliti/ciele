import { describe, expect, it } from "vitest";
import type { HttpWebhookSettings, WebhookSubscription } from "./types";
import {
  DEFAULT_WEBHOOK_TIMEOUT_MINUTES,
  MAX_WEBHOOK_TIMEOUT_MINUTES,
  WEBHOOK_PAYLOAD_MAX_CHARS,
  cappedWebhookPayload,
  expireWebhook,
  httpWebhookSettingsIssue,
  isWebhookOverdue,
  receiveWebhook,
  webhookExpiresAt,
  webhookHaltMessage,
  webhookTemplateVariables,
  webhookTimeoutMinutes,
} from "./webhook";


/**
 * The callback gate's state machine (#842). pending → received (the first
 * callback) | expired (the clock) | failed (the subscribe call never landed).
 * Every transition is decided here, so the callback route, the expiry sweep
 * and the resumption job cannot disagree about which callback counts.
 */

const NOW = new Date("2026-09-09T12:00:00.000Z");

const subscription = (over: Partial<WebhookSubscription> = {}): WebhookSubscription => ({
  id: "wh1",
  organizationId: "org1",
  assistantId: "a1",
  conversationId: "c1",
  flowId: "f1",
  actionIndex: 1,
  status: "pending",
  subscribeMethod: "POST",
  subscribeUrl: "https://api.example.com/subscribe",
  unsubscribeMethod: "DELETE",
  unsubscribeUrl: "https://api.example.com/subscribe/1",
  unsubscribeBody: null,
  unsubscribedAt: null,
  payload: null,
  receivedAt: null,
  expiresAt: new Date(NOW.getTime() + 15 * 60_000).toISOString(),
  haltMessage: "",
  simulated: false,
  resumedAt: null,
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
  ...over,
});

describe("how long the gate waits", () => {
  it("defaults, floors and caps the timeout", () => {
    expect(webhookTimeoutMinutes({})).toBe(DEFAULT_WEBHOOK_TIMEOUT_MINUTES);
    expect(webhookTimeoutMinutes({ timeoutMinutes: 0 })).toBe(DEFAULT_WEBHOOK_TIMEOUT_MINUTES);
    expect(webhookTimeoutMinutes({ timeoutMinutes: -5 })).toBe(DEFAULT_WEBHOOK_TIMEOUT_MINUTES);
    expect(webhookTimeoutMinutes({ timeoutMinutes: 1.7 })).toBe(1);
    expect(webhookTimeoutMinutes({ timeoutMinutes: 99_999 })).toBe(MAX_WEBHOOK_TIMEOUT_MINUTES);
  });

  it("expires only what is actually overdue, and only while pending", () => {
    const overdue = subscription({ expiresAt: new Date(NOW.getTime() - 1).toISOString() });
    expect(isWebhookOverdue(overdue, NOW)).toBe(true);
    expect(expireWebhook(overdue, NOW)?.status).toBe("expired");
    expect(isWebhookOverdue(subscription(), NOW)).toBe(false);
    expect(expireWebhook(subscription(), NOW)).toBeNull();
    // A callback that already landed is not made stale by the clock.
    expect(expireWebhook({ ...overdue, status: "received" }, NOW)).toBeNull();
  });

  it("dates the expiry from when the subscription was made", () => {
    expect(webhookExpiresAt(NOW, 30)).toBe(new Date(NOW.getTime() + 30 * 60_000).toISOString());
  });
});

describe("the first callback wins", () => {
  it("records the body and closes the gate", () => {
    const next = receiveWebhook(subscription(), '{"status":"done"}', NOW);
    expect(next).not.toBeNull();
    expect(next!.status).toBe("received");
    expect(next!.payload).toBe('{"status":"done"}');
    expect(next!.receivedAt).toBe(NOW.toISOString());
  });

  it("refuses a callback that arrives after the wait ran out, even before the sweep noticed", () => {
    const row = subscription();
    const late = new Date(Date.parse(row.expiresAt) + 1);
    expect(receiveWebhook(row, "{}", late)).toBeNull();
    expect(receiveWebhook(row, "{}", new Date(Date.parse(row.expiresAt) - 1))).not.toBeNull();
  });

  it("changes nothing on a second callback, so a retrying caller cannot answer twice", () => {
    const received = receiveWebhook(subscription(), "{}", NOW)!;
    expect(receiveWebhook(received, '{"different":true}', NOW)).toBeNull();
    expect(receiveWebhook(subscription({ status: "expired" }), "{}", NOW)).toBeNull();
  });

  it("caps the stored body rather than refusing a large one", () => {
    // The turn only needs enough to extract from; a caller that posts a
    // megabyte should not fail the gate it was answering.
    const long = "x".repeat(WEBHOOK_PAYLOAD_MAX_CHARS + 500);
    expect(cappedWebhookPayload(long).length).toBe(WEBHOOK_PAYLOAD_MAX_CHARS);
    expect(cappedWebhookPayload(null)).toBe("");
  });
});

describe("what the actions after the gate can read", () => {
  it("offers the status and the raw body", () => {
    const received = receiveWebhook(subscription(), '{"orderId":"A-1"}', NOW)!;
    const vars = webhookTemplateVariables(received);
    expect(vars["webhook.status"]).toBe("received");
    expect(vars["webhook.received"]).toBe("true");
    expect(vars["webhook.body"]).toBe('{"orderId":"A-1"}');
  });

  it("says plainly that nothing arrived when the gate timed out", () => {
    const expired = expireWebhook(
      subscription({ expiresAt: new Date(NOW.getTime() - 1).toISOString() }),
      NOW
    )!;
    const vars = webhookTemplateVariables(expired);
    expect(vars["webhook.received"]).toBe("false");
    expect(vars["webhook.body"]).toBe("");
  });
});

describe("the halt message", () => {
  it("uses the configured line, and a plain default when there is none", () => {
    expect(webhookHaltMessage({ status: "expired", haltMessage: "No reply yet." })).toBe(
      "No reply yet."
    );
    expect(webhookHaltMessage({ status: "expired", haltMessage: "" })).toMatch(/didn't hear back/i);
    expect(webhookHaltMessage({ status: "failed", haltMessage: "" })).toMatch(/couldn't reach/i);
  });
});

describe("the Needs-setup rule", () => {
  const ok: HttpWebhookSettings = {
    subscribe: {
      method: "POST",
      url: "https://api.example.com/subscribe",
      bodyTemplate: '{"callback":"{{webhook.callbackUrl}}"}',
    },
  };

  it("passes a subscribe call with a URL and somewhere to call back", () => {
    expect(httpWebhookSettingsIssue(ok)).toBeNull();
  });

  it("names what is missing", () => {
    expect(httpWebhookSettingsIssue(undefined)).toMatch(/not configured/i);
    expect(httpWebhookSettingsIssue({})).toMatch(/subscribe/i);
    expect(httpWebhookSettingsIssue({ subscribe: { url: "  " } })).toMatch(/subscribe/i);
    expect(httpWebhookSettingsIssue({ subscribe: { url: "not a url" } })).toMatch(/valid/i);
    expect(
      httpWebhookSettingsIssue({ ...ok, unsubscribe: { url: "also not a url" } })
    ).toMatch(/unsubscribe/i);
  });

  it("insists the subscribe call can say where to call back", () => {
    // Without the callback URL somewhere in the request the other system has
    // no way to answer, so the gate could only ever expire. Cheap to catch
    // here; the alternative is a Flow that waits fifteen minutes to prove it.
    expect(
      httpWebhookSettingsIssue({
        subscribe: { method: "POST", url: "https://api.example.com/subscribe" },
      })
    ).toMatch(/call back/i);
    // In the query string counts as much as in the body.
    expect(
      httpWebhookSettingsIssue({
        subscribe: {
          method: "GET",
          url: "https://api.example.com/subscribe?cb={{webhook.callbackUrl}}",
        },
      })
    ).toBeNull();
  });
});
