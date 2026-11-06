import { createHmac } from "node:crypto";
import type { OutboundWebhookEvent } from "@agent-hub/core";
import { isOutboundWebhookEvent, openSecret, outboundWebhookRetryAt } from "@agent-hub/core";
import { egressFetch, validateEgressTarget, EgressPolicyError } from "./egress";
import { getRuntimeHost } from "./host";
import { nonRetryable } from "./job-errors";
import type { JobHandler } from "./jobs";

/** The receiver signs the timestamp, a dot, then the exact UTF-8 JSON body. */
export function outboundWebhookSignature(secret: string, body: string, now: Date): string {
  const timestamp = Math.floor(now.getTime() / 1000);
  const digest = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${digest}`;
}

function outboundEgressPolicy() {
  const relaxed = getRuntimeHost().allowRelaxedEgress();
  return { allowHttp: relaxed, allowLoopback: relaxed };
}

/** Configuration and every delivery use the same policy, including DNS checks. */
export async function validateOutboundWebhookUrl(url: string): Promise<void> {
  await validateEgressTarget(url, outboundEgressPolicy());
}

/** One attempt only. Retry, persistence and Alerts belong to the job ledger. */
export async function sendOutboundWebhook(input: {
  url: string;
  secret: string;
  event: OutboundWebhookEvent;
  now?: Date;
}): Promise<number> {
  if (!isOutboundWebhookEvent(input.event)) throw new Error("Invalid outbound webhook event");
  const body = JSON.stringify(input.event);
  const controller = new AbortController();
  const timeoutError = new Error("Webhook delivery timed out");
  // Bound DNS resolution and the complete response, including a trickling body.
  const timeout = setTimeout(() => controller.abort(timeoutError), 10_000);
  const deadline = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener("abort", () => reject(timeoutError), { once: true });
  });
  try {
    const { response } = await Promise.race([deadline, egressFetch(input.url, {
      ...outboundEgressPolicy(),
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Ciele-Signature": outboundWebhookSignature(input.secret, body, input.now ?? new Date()),
      },
      body,
      timeoutMs: 10_000,
      maxResponseBytes: 64 * 1024,
      maxRedirects: 0,
      redirect: "manual",
      signal: controller.signal,
    })]);
    return response.status;
  } finally {
    clearTimeout(timeout);
  }
}

const alertKey = (subscriptionId: string) => `outbound-webhook:${subscriptionId}`;

export const outboundWebhookHandler: JobHandler = {
  retryAt(record, now) {
    return outboundWebhookRetryAt(record.createdAt, record.attempts, now);
  },
  async perform(record, { db }) {
    const deliveryId = record.payload.deliveryId;
    if (typeof deliveryId !== "string" || !record.leaseToken) throw nonRetryable("Invalid webhook job");
    const delivery = await db.table("webhookDeliveries").get(deliveryId);
    // A deleted subscription cascades to its deliveries and cancels pending sends.
    if (!delivery) return;
    if (delivery.organizationId !== record.organizationId || !isOutboundWebhookEvent(delivery.event)) throw nonRetryable("Invalid webhook delivery");
    const subscription = await db.table("outboundWebhookSubscriptions").get(delivery.subscriptionId);
    if (!subscription) return;
    if (subscription.organizationId !== record.organizationId || delivery.event.organizationId !== record.organizationId) throw nonRetryable("Webhook Organization mismatch");
    if (delivery.status === "delivered") {
      await db.resolveAlertsByKey(record.organizationId, alertKey(subscription.id));
      return;
    }
    if (Date.now() >= Date.parse(record.createdAt) + 24 * 60 * 60_000) throw nonRetryable("The webhook delivery window expired");
    if (subscription.paused) throw new Error("The webhook subscription is paused");
    const encryptedSecret = await db.getOutboundWebhookSecret(subscription.id);
    if (!encryptedSecret) throw nonRetryable("The webhook signing secret is unavailable");
    let statusCode: number | null = null;
    let failure: unknown;
    try {
      statusCode = await sendOutboundWebhook({ url: subscription.url, secret: openSecret(encryptedSecret), event: delivery.event });
    } catch (error) {
      failure = error;
    }
    const delivered = statusCode !== null && statusCode >= 200 && statusCode < 300;
    const recorded = await db.recordWebhookDeliveryAttempt({
      deliveryId, jobId: record.id, leaseToken: record.leaseToken, now: new Date().toISOString(),
      statusCode, status: delivered ? "delivered" : "queued",
    });
    if (!recorded) return; // A reclaimed lease owns both the ledger and the log now.
    if (delivered) {
      await db.resolveAlertsByKey(record.organizationId, alertKey(subscription.id));
      return;
    }
    if (failure instanceof EgressPolicyError && failure.code !== "resolution_failed") throw nonRetryable(failure.message);
    throw failure ?? new Error(`Webhook receiver returned HTTP ${statusCode}`);
  },
  async onTerminalFailure(record, { db }) {
    const deliveryId = record.payload.deliveryId;
    if (typeof deliveryId !== "string" || !record.leaseToken) return;
    const delivery = await db.table("webhookDeliveries").get(deliveryId);
    if (!delivery || delivery.status === "delivered") return;
    const recorded = await db.recordWebhookDeliveryAttempt({
      deliveryId, jobId: record.id, leaseToken: record.leaseToken, now: new Date().toISOString(),
      statusCode: delivery.lastStatusCode, status: "failed",
    });
    if (!recorded) return;
    const subscription = await db.table("outboundWebhookSubscriptions").get(delivery.subscriptionId);
    if (!subscription || subscription.paused) return;
    await db.raiseAlert(record.organizationId, {
      type: "integration", title: `Webhook delivery failed: ${subscription.name}`,
      detail: "The webhook subscription exhausted its delivery attempts. Check its URL and receiver. The next successful delivery clears this Alert.",
      sourceKey: alertKey(subscription.id),
    });
  },
};
