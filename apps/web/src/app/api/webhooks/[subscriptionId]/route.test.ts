import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  verifyWebhookCallbackToken: vi.fn(),
  deliverWebhookCallback: vi.fn(),
}));

vi.mock("@agent-hub/agent", () => ({
  verifyWebhookCallbackToken: mocks.verifyWebhookCallbackToken,
  deliverWebhookCallback: mocks.deliverWebhookCallback,
}));
vi.mock("@/lib/service-db", () => ({ getServiceRoleDb: () => ({}) }));

import { POST } from "./route";

/**
 * The callback route (#842) is unauthenticated by construction, so these pin
 * the two things that stand in for authentication: the token decides, and a
 * spray of guesses runs out of budget per caller rather than per guess.
 */
function post(subscriptionId: string, token: string, address = "203.0.113.7") {
  return POST(
    new NextRequest(`https://ciele.example/api/webhooks/${subscriptionId}?t=${token}`, {
      method: "POST",
      body: '{"state":"done"}',
      headers: { "content-type": "application/json", "x-forwarded-for": address },
    }),
    { params: Promise.resolve({ subscriptionId }) }
  );
}

describe("the webhook callback route", () => {
  beforeEach(() => {
    mocks.verifyWebhookCallbackToken.mockReset();
    mocks.deliverWebhookCallback.mockReset();
    mocks.deliverWebhookCallback.mockResolvedValue({ ok: true, duplicate: false });
  });

  it("refuses a bad token, and a good token for a different subscription, the same way", async () => {
    mocks.verifyWebhookCallbackToken.mockReturnValue({ ok: false, reason: "bad_signature" });
    expect((await post("wh1", "nope", "198.51.100.1")).status).toBe(401);
    mocks.verifyWebhookCallbackToken.mockReturnValue({ ok: true, subscriptionId: "other" });
    expect((await post("wh1", "stolen", "198.51.100.1")).status).toBe(401);
    expect(mocks.deliverWebhookCallback).not.toHaveBeenCalled();
  });

  it("applies a verified callback and answers a duplicate as a success", async () => {
    mocks.verifyWebhookCallbackToken.mockReturnValue({ ok: true, subscriptionId: "wh1" });
    const first = await post("wh1", "good", "198.51.100.2");
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ status: "received" });
    mocks.deliverWebhookCallback.mockResolvedValue({ ok: true, duplicate: true });
    expect(await (await post("wh1", "good", "198.51.100.2")).json()).toEqual({ status: "duplicate" });
    mocks.deliverWebhookCallback.mockResolvedValue({ ok: false, reason: "closed" });
    expect((await post("wh1", "good", "198.51.100.2")).status).toBe(410);
  });

  it("rate-limits by the caller's address, so guessing ids buys no fresh budget", async () => {
    mocks.verifyWebhookCallbackToken.mockReturnValue({ ok: false, reason: "bad_signature" });
    const address = "192.0.2.44";
    let limited: Response | null = null;
    for (let i = 0; i < 121; i += 1) {
      const response = await post(`guess-${i}`, "x", address);
      if (response.status === 429) {
        limited = response;
        break;
      }
    }
    expect(limited?.status).toBe(429);
    expect(limited?.headers.get("retry-after")).toBeTruthy();
    // Another address still has its own budget.
    expect((await post("guess-0", "x", "192.0.2.45")).status).toBe(401);
  });
});
