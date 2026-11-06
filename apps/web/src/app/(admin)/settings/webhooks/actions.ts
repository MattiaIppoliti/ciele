"use server";
import {
  OperationError, createOutboundWebhookOp, updateOutboundWebhookOp,
  deleteOutboundWebhookOp, listWebhookDeliveriesOp, sendWebhookTestOp,
} from "@ciele/ops";
import type { OutboundWebhookSubscription } from "@agent-hub/core";
import { CapabilityRefusedError } from "@/lib/authz";
import { runOperation } from "@/lib/operations";

type Fields = Pick<OutboundWebhookSubscription, "name" | "url" | "eventTypes">;
type Result<T> = { ok: true; value: T } | { ok: false; error: string };
async function attempt<T>(run: () => Promise<T>): Promise<Result<T>> {
  try { return { ok: true, value: await run() }; }
  catch (error) {
    if (error instanceof OperationError || error instanceof CapabilityRefusedError) return { ok: false, error: error.message };
    throw error;
  }
}
export async function createWebhookAction(input: Fields) { return attempt(() => runOperation(createOutboundWebhookOp, input)); }
export async function updateWebhookAction(id: string, patch: Partial<Fields> & { paused?: boolean }) { return attempt(() => runOperation(updateOutboundWebhookOp, { id, patch })); }
export async function deleteWebhookAction(id: string) { return attempt(() => runOperation(deleteOutboundWebhookOp, { id })); }
export async function webhookDeliveriesAction(id: string) { return attempt(() => runOperation(listWebhookDeliveriesOp, { id })); }
export async function sendWebhookTestAction(id: string) { return attempt(() => runOperation(sendWebhookTestOp, { id })); }
