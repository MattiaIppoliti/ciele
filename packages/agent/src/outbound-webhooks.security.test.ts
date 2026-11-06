import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { OUTBOUND_WEBHOOK_EXAMPLES, type OutboundWebhookEvent } from "@agent-hub/core";
import { EgressPolicyError } from "./egress";
import { registerRuntimeHost, resetRuntimeHost } from "./host";
import { outboundWebhookSignature, sendOutboundWebhook, validateOutboundWebhookUrl } from "./outbound-webhooks";

const now = new Date("2026-10-22T10:00:00Z");
const secret = "synthetic-test-signing-secret";
const event: OutboundWebhookEvent = {
  id: "event-example", type: "conversation.escalated", createdAt: now.toISOString(), organizationId: "org-example",
  data: OUTBOUND_WEBHOOK_EXAMPLES["conversation.escalated"],
};

afterEach(resetRuntimeHost);

describe("signed outbound webhook transport", () => {
  it("aborts a trickling response after ten seconds of total delivery time", async () => {
    registerRuntimeHost({ allowRelaxedEgress: () => true });
    let chunksSent = 0;
    const server = createServer((_request, response) => {
      response.writeHead(200);
      response.write("start");
      const trickle = setInterval(() => { chunksSent += 1; response.write("."); }, 100);
      response.on("close", () => clearInterval(trickle));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing test server address");
      const started = Date.now();
      await expect(sendOutboundWebhook({ url: `http://127.0.0.1:${address.port}/events`, secret, event, now }))
        .rejects.toThrow("Webhook delivery timed out");
      expect(Date.now() - started).toBeLessThan(12_000);
      expect(chunksSent).toBeGreaterThan(1);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 15_000);

  it("signs the exact body with a timestamp, and changes signatures between attempts", () => {
    const body = JSON.stringify(event);
    const timestamp = Math.floor(now.getTime() / 1000);
    const expected = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
    const signature = outboundWebhookSignature(secret, body, now);
    expect(signature).toBe(`t=${timestamp},v1=${expected}`);
    expect(outboundWebhookSignature(secret, `${body}\n`, now)).not.toBe(signature);
    expect(outboundWebhookSignature(secret, body, new Date(now.getTime() + 60_000))).not.toBe(signature);
    expect(outboundWebhookSignature("another-secret", body, now)).not.toBe(signature);
  });

  it("refuses HTTP and private targets without contacting them", async () => {
    for (const url of ["http://example.com/events", "https://127.0.0.1/events", "https://10.1.2.3/events", "https://[::1]/events"]) {
      await expect(validateOutboundWebhookUrl(url)).rejects.toBeInstanceOf(EgressPolicyError);
      await expect(sendOutboundWebhook({ url, secret, event, now })).rejects.toBeInstanceOf(EgressPolicyError);
    }
  });

  it("POSTs verifiable JSON through the guarded transport when the host permits loopback", async () => {
    registerRuntimeHost({ allowRelaxedEgress: () => true });
    let received: { body: string; signature: string; method?: string } | undefined;
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      received = { body: Buffer.concat(chunks).toString("utf8"), signature: String(request.headers["ciele-signature"]), method: request.method };
      response.writeHead(202).end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing test server address");
      const status = await sendOutboundWebhook({ url: `http://127.0.0.1:${address.port}/events`, secret, event, now });
      expect(status).toBe(202);
      expect(received?.method).toBe("POST");
      expect(received?.body).toBe(JSON.stringify(event));
      const signature = received?.signature.match(/^t=(\d+),v1=([a-f0-9]{64})$/);
      if (!signature || !received) throw new Error("Missing timestamp or digest");
      expect(Math.abs(now.getTime() / 1000 - Number(signature[1]))).toBeLessThanOrEqual(300);
      const expected = createHmac("sha256", secret).update(`${signature[1]}.${received.body}`).digest();
      expect(timingSafeEqual(expected, Buffer.from(signature[2], "hex"))).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
