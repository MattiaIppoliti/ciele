import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  isOutboundWebhookEventType, OUTBOUND_WEBHOOK_EVENTS, OUTBOUND_WEBHOOK_EXAMPLES, sealSecret, shortId,
} from "@agent-hub/core";
import { defineOperation, OperationError, type OperationContext } from "./operation";

const id = z.string().trim().min(1).max(200);
const supportedEventTypes = Object.keys(OUTBOUND_WEBHOOK_EVENTS).filter(isOutboundWebhookEventType);
export const outboundWebhookInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  url: z.string().trim().url().max(2_000),
  eventTypes: z.array(z.enum(supportedEventTypes)).min(1).max(supportedEventTypes.length),
});
export const outboundWebhookPatchSchema = outboundWebhookInputSchema.partial().extend({ paused: z.boolean().optional() });

async function requireSubscription(ctx: OperationContext, subscriptionId: string) {
  const subscription = await ctx.db.table("outboundWebhookSubscriptions").get(subscriptionId);
  if (!subscription || subscription.organizationId !== ctx.organizationId) throw new OperationError("not_found", "Webhook subscription not found");
  return subscription;
}

async function validateUrl(ctx: OperationContext, url: string) {
  const port = ctx.ports?.outboundWebhooks;
  if (!port) throw new OperationError("invalid_input", "Webhook delivery is unavailable on this surface");
  try { await port.validateUrl(url); }
  catch (error) { throw new OperationError("invalid_input", error instanceof Error ? error.message : "This webhook URL is not allowed"); }
}

const changed = () => [{ kind: "webhookSettings" as const }];

export const listOutboundWebhooksOp = defineOperation({
  name: "webhooks.list", capability: "webhooks:manage", effect: "read", input: z.object({}), entities: () => [],
  run: async (ctx) => {
    try {
      return { available: true, items: await ctx.db.table("outboundWebhookSubscriptions").list({ organizationId: ctx.organizationId }) };
    } catch (error) {
      // One additive migration behind: Settings shows a disabled setup state.
      if (typeof error === "object" && error !== null && "code" in error && (error.code === "42P01" || error.code === "PGRST205")) return { available: false, items: [] };
      throw error;
    }
  },
});

export const createOutboundWebhookOp = defineOperation({
  name: "webhooks.create", capability: "webhooks:manage", effect: "consequential", input: outboundWebhookInputSchema, entities: changed,
  run: async (ctx, input) => {
    await validateUrl(ctx, input.url);
    const secret = randomBytes(32).toString("hex");
    const subscription = await ctx.db.createOutboundWebhookSubscription(ctx.organizationId, {
      ...input, eventTypes: [...new Set(input.eventTypes)], encryptedSecret: sealSecret(secret),
    });
    return { subscription, secret };
  },
});

export const updateOutboundWebhookOp = defineOperation({
  name: "webhooks.update", capability: "webhooks:manage", effect: "consequential",
  input: z.object({ id, patch: outboundWebhookPatchSchema }), entities: changed,
  run: async (ctx, input) => {
    await requireSubscription(ctx, input.id);
    if (input.patch.url) await validateUrl(ctx, input.patch.url);
    return ctx.db.table("outboundWebhookSubscriptions").update(input.id, {
      ...input.patch, ...(input.patch.eventTypes ? { eventTypes: [...new Set(input.patch.eventTypes)] } : {}),
    });
  },
});

export const deleteOutboundWebhookOp = defineOperation({
  name: "webhooks.delete", capability: "webhooks:manage", effect: "consequential", input: z.object({ id }), entities: changed,
  run: async (ctx, input) => {
    await requireSubscription(ctx, input.id);
    await ctx.db.table("outboundWebhookSubscriptions").delete(input.id);
  },
});

export const listWebhookDeliveriesOp = defineOperation({
  name: "webhooks.deliveries", capability: "webhooks:manage", effect: "read", input: z.object({ id }), entities: () => [],
  run: async (ctx, input) => {
    await requireSubscription(ctx, input.id);
    return ctx.db.table("webhookDeliveries").list({ organizationId: ctx.organizationId, subscriptionId: input.id }, { limit: 100 });
  },
});

export const sendWebhookTestOp = defineOperation({
  name: "webhooks.test", capability: "webhooks:manage", effect: "consequential", input: z.object({ id }), entities: changed,
  run: async (ctx, input) => {
    const subscription = await requireSubscription(ctx, input.id);
    if (subscription.paused) throw new OperationError("invalid_input", "Resume this subscription before sending a test event");
    const eventId = shortId();
    await ctx.db.queueOutboundWebhookEvent(ctx.organizationId, {
      id: eventId, type: "conversation.escalated", createdAt: new Date().toISOString(), organizationId: ctx.organizationId,
      data: OUTBOUND_WEBHOOK_EXAMPLES["conversation.escalated"],
    }, subscription.id);
    ctx.ports?.outboundWebhooks?.wakeDeliveries();
    return { eventId };
  },
});
