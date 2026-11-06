import { afterEach, describe, expect, it, vi } from "vitest";
import { openSecret } from "@agent-hub/core";
import { DEMO_MEMBER, DEMO_ORG, getMockDb } from "@agent-hub/db";
import type { OperationContext } from "./operation";
import {
  createOutboundWebhookOp, deleteOutboundWebhookOp, listOutboundWebhooksOp,
  listWebhookDeliveriesOp, sendWebhookTestOp, updateOutboundWebhookOp,
} from "./outbound-webhooks";
import { platformOperationPolicy } from "./platform-actions";
import { teammateActions } from "./teammate-actions";

const db = getMockDb();
const ctx: OperationContext = {
  organizationId: DEMO_ORG.id, userId: DEMO_MEMBER.userId, role: "admin", db,
  ports: { outboundWebhooks: { validateUrl: async (url) => { if (!url.startsWith("https://public.example/")) throw new Error("URL refused by egress"); }, wakeDeliveries: () => {} } },
};

afterEach(async () => {
  for (const row of await db.table("outboundWebhookSubscriptions").list({ organizationId: DEMO_ORG.id })) await db.table("outboundWebhookSubscriptions").delete(row.id);
  vi.unstubAllEnvs();
});

describe("outbound webhook operations", () => {
  it("reports setup as unavailable when the new table is not deployed", async () => {
    const lagDb = { ...db, table: () => { throw Object.assign(new Error("Relation is not deployed"), { code: "42P01" }); } };
    expect(await listOutboundWebhooksOp.run({ ...ctx, db: lagDb }, {})).toEqual({ available: false, items: [] });
  });

  it("returns a generated secret once, supports pause/resume and queues a synthetic test", async () => {
    vi.stubEnv("APP_ENCRYPTION_KEY", "synthetic-ops-webhook-key");
    const created = await createOutboundWebhookOp.run(ctx, { name: "Receiver", url: "https://public.example/events", eventTypes: ["conversation.escalated"] });
    expect(created.secret).toMatch(/^[a-f0-9]{64}$/);
    const sealed = await db.getOutboundWebhookSecret(created.subscription.id);
    if (!sealed) throw new Error("Missing sealed secret");
    expect(sealed).not.toContain(created.secret);
    expect(openSecret(sealed)).toBe(created.secret);
    expect(await listOutboundWebhooksOp.run(ctx, {})).toMatchObject({ available: true, items: [created.subscription] });
    expect(JSON.stringify(await listOutboundWebhooksOp.run(ctx, {}))).not.toContain(created.secret);
    expect(await updateOutboundWebhookOp.run(ctx, { id: created.subscription.id, patch: { paused: true } })).toMatchObject({ paused: true });
    await expect(sendWebhookTestOp.run(ctx, { id: created.subscription.id })).rejects.toThrow(/resume/i);
    await updateOutboundWebhookOp.run(ctx, { id: created.subscription.id, patch: { paused: false } });
    const test = await sendWebhookTestOp.run(ctx, { id: created.subscription.id });
    expect(await listWebhookDeliveriesOp.run(ctx, { id: created.subscription.id })).toMatchObject([{ event: { id: test.eventId, type: "conversation.escalated" }, status: "queued", attempts: 0 }]);
    await expect(updateOutboundWebhookOp.run(ctx, { id: created.subscription.id, patch: { url: "http://127.0.0.1/events" } })).rejects.toThrow(/egress/i);
    expect((await db.table("outboundWebhookSubscriptions").get(created.subscription.id))?.url).toBe(created.subscription.url);
    await deleteOutboundWebhookOp.run(ctx, { id: created.subscription.id });
    expect(await db.getOutboundWebhookSecret(created.subscription.id)).toBeNull();
    expect((await listOutboundWebhooksOp.run(ctx, {})).items).toEqual([]);
  });

  it("requires confirmation for mutations and offers no webhook operation to an ordinary Teammate", () => {
    for (const op of [createOutboundWebhookOp, updateOutboundWebhookOp, deleteOutboundWebhookOp, sendWebhookTestOp]) {
      expect(op.capability).toBe("webhooks:manage");
      expect(platformOperationPolicy(op.name)).toBe("confirm");
    }
    expect(teammateActions({ id: "t1", name: "Nora", ceiling: "edit", grants: ["inbox", "improvements", "knowledge"], approvalBypass: true }).some((action) => action.operation.name.startsWith("webhooks."))).toBe(false);
  });
});
