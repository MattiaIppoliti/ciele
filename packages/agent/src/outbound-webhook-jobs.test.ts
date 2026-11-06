import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OUTBOUND_WEBHOOK_EXAMPLES, sealSecret } from "@agent-hub/core";
import { DEMO_ORG, getMockDb } from "@agent-hub/db";
import { registerRuntimeHost, resetRuntimeHost } from "./host";
import { finalizeDueCrawls } from "./scheduled";

afterEach(() => { resetRuntimeHost(); vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("outbound webhook durable jobs", () => {
  it("retries on the ledger, keeps the event id and clears terminal-failure Alerts on the next success", async () => {
    vi.stubEnv("APP_ENCRYPTION_KEY", "synthetic-webhook-job-key");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-22T10:00:00Z"));
    registerRuntimeHost({ allowRelaxedEgress: () => true });
    const db = getMockDb();
    const requests: { body: string; signature: string }[] = [];
    let responseStatus = 503;
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      requests.push({ body: Buffer.concat(chunks).toString("utf8"), signature: String(request.headers["ciele-signature"]) });
      response.writeHead(responseStatus, responseStatus === 302 ? { location: "http://10.0.0.1/events" } : {}).end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing test server address");
      const subscription = await db.createOutboundWebhookSubscription(DEMO_ORG.id, {
        name: "Job receiver", url: `http://127.0.0.1:${address.port}/events`, eventTypes: ["conversation.escalated"], encryptedSecret: sealSecret("test-signing-secret"),
      });
      const event = { id: "job-retry-event", type: "conversation.escalated" as const, createdAt: new Date().toISOString(), organizationId: DEMO_ORG.id, data: OUTBOUND_WEBHOOK_EXAMPLES["conversation.escalated"] };
      await db.queueOutboundWebhookEvent(DEMO_ORG.id, event);
      const drain = async () => (await finalizeDueCrawls({ db })).outboundWebhooks;
      expect(await drain()).toMatchObject({ claimed: 1, retried: 1 });
      expect(await db.table("webhookDeliveries").list({ subscriptionId: subscription.id })).toMatchObject([{ attempts: 1, lastStatusCode: 503, status: "queued" }]);
      vi.setSystemTime(new Date("2026-10-22T10:00:59Z"));
      expect(await drain()).toMatchObject({ claimed: 0 });
      responseStatus = 302;
      vi.setSystemTime(new Date("2026-10-22T10:01:00Z"));
      expect(await drain()).toMatchObject({ retried: 1 });
      expect(await db.table("webhookDeliveries").list({ subscriptionId: subscription.id })).toMatchObject([{ attempts: 2, lastStatusCode: 302, status: "queued" }]);
      expect(requests).toHaveLength(2);
      expect(requests[1].body).toBe(requests[0].body);
      expect(requests[1].signature).not.toBe(requests[0].signature);
      // A delayed worker cannot POST beyond the 24-hour delivery window.
      vi.setSystemTime(new Date("2026-10-23T10:01:00Z"));
      expect(await drain()).toMatchObject({ failed: 1 });
      expect(requests).toHaveLength(2);
      expect((await db.listAlerts(DEMO_ORG.id)).some((alert) => alert.status === "active" && alert.title.includes(subscription.name))).toBe(true);
      responseStatus = 202;
      await db.queueOutboundWebhookEvent(DEMO_ORG.id, { ...event, id: "job-success-event", createdAt: new Date().toISOString() });
      expect(await drain()).toMatchObject({ succeeded: 1 });
      expect((await db.listAlerts(DEMO_ORG.id)).filter((alert) => alert.sourceKey === `outbound-webhook:${subscription.id}`).every((alert) => alert.status === "resolved")).toBe(true);
      const deliveries = await db.table("webhookDeliveries").list({ subscriptionId: subscription.id });
      expect(deliveries.find((delivery) => delivery.event.id === "job-success-event")).toMatchObject({ status: "delivered", attempts: 1, lastStatusCode: 202 });
      await db.table("outboundWebhookSubscriptions").delete(subscription.id);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
