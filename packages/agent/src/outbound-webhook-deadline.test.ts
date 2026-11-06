import { afterEach, expect, it, vi } from "vitest";
import { OUTBOUND_WEBHOOK_EXAMPLES } from "@agent-hub/core";
import { pinnedRequest } from "./pinned-fetch";
import { sendOutboundWebhook } from "./outbound-webhooks";

const { lookupMock } = vi.hoisted(() => ({
  lookupMock: vi.fn<() => Promise<Array<{ address: string; family: number }>>>(),
}));
vi.mock("node:dns/promises", () => ({ lookup: lookupMock }));
vi.mock("./pinned-fetch", () => ({ pinnedRequest: vi.fn() }));
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });

it("bounds DNS resolution and never sends after a timed-out lookup completes", async () => {
  vi.useFakeTimers();
  const addresses = [{ address: "93.184.216.34", family: 4 }];
  lookupMock.mockImplementationOnce(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 20_000));
    return addresses;
  });
  const pending = sendOutboundWebhook({
    url: "https://receiver.example/events", secret: "synthetic-secret",
    event: { id: "dns-deadline", type: "conversation.escalated", createdAt: new Date().toISOString(), organizationId: "org-example", data: OUTBOUND_WEBHOOK_EXAMPLES["conversation.escalated"] },
  });
  const rejected = expect(pending).rejects.toThrow("Webhook delivery timed out");
  await vi.advanceTimersByTimeAsync(10_000);
  await rejected;
  await vi.runAllTimersAsync();
  expect(pinnedRequest).not.toHaveBeenCalled();
});
