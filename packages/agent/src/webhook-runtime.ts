import type {
  Assistant,
  Conversation,
  FlowActionSettings,
  WebhookCall,
  WebhookSubscription,
} from "@agent-hub/core";
import {
  expireWebhook,
  receiveWebhook,
  webhookHaltMessage,
  webhookTemplateVariables,
} from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import { executeApiRequest, extractApiJsonPaths } from "./api-request";
import { resumeGateTurn } from "./resume-gate-turn";
import { gateTokens } from "./gate-token";
import { getRuntimeHost } from "./host";
import { nonRetryable } from "./job-errors";
import type { JobHandler } from "./jobs";
import { platformAppOrigin } from "./template";
import type { ChatReplyPart, WebhookRuntime } from "./types";

/**
 * The callback gate's runtime (#842): what happens after the action stopped
 * the turn.
 *
 * Deliberately the Human review gate's shape (#841), because it is the same
 * problem: a Flow stops mid-turn, something outside decides, and the turn
 * continues from a stored cursor. What differs is who closes the gate. A
 * review is closed by a Member the console authenticated; a subscription is
 * closed by an anonymous caller holding a URL we minted. So the token *is* the
 * authorization, and "the first callback wins" (decided in core) is what stops
 * a retrying caller running the rest of the Flow twice.
 *
 * Three pieces:
 *
 * - {@link dbWebhookRuntime}, the port the `http_webhook` action calls: insert
 *   the row and mark the Conversation as waiting.
 * - {@link resumeWebhookConversation}, the durable job (ADR-0008) that
 *   continues the Flow when the callback lands, or persists the halt message
 *   when it does not.
 * - {@link expireDueWebhooks}, the clock: pending and overdue then expired,
 *   followed by the same resumption job down the halt path.
 *
 * Subscribing is **not** a job. A subscribe that fails has to halt the Flow
 * then and there: a queued subscribe would leave a Visitor waiting on a
 * request nobody had made yet, and the failure would surface minutes later
 * with nothing to attach it to.
 */

export const RESUME_WEBHOOK_KIND = "resume_webhook_conversation" as const;

// ---------------------------------------------------------------------------
// The signed callback URL.
// ---------------------------------------------------------------------------

/**
 * An hour's grace past the wait's own expiry on the *token*, so a caller that
 * answers a second late reads "too late" rather than "bad signature", and the
 * two stay distinguishable in a log. The grace buys the caller a clearer
 * answer and nothing else: `receiveWebhook` refuses a callback past
 * `expiresAt` whatever the token says, so a late one is answered "closed" and
 * never resumes the Flow. Far shorter than a review link's week: nobody is
 * going to open this one out of a mailbox on Monday.
 */
const callbackTokens = gateTokens("webhook-callback-v1", 3_600_000);

/**
 * The token the callback URL carries: the subscription id and its expiry,
 * signed. The expiry is inside the signed material, so a URL that leaked out of
 * the other system's logs cannot outlive the wait it belonged to.
 */
export function mintWebhookCallbackToken(
  subscription: Pick<WebhookSubscription, "id" | "expiresAt">
): string {
  return callbackTokens.mint(subscription);
}

export type WebhookTokenVerdict =
  | { ok: true; subscriptionId: string }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" | "unconfigured" };

export function verifyWebhookCallbackToken(
  token: string,
  options: { now?: Date; graceMs?: number } = {}
): WebhookTokenVerdict {
  const verdict = callbackTokens.verify(token, options);
  return verdict.ok ? { ok: true, subscriptionId: verdict.id } : verdict;
}

export function webhookCallbackUrl(
  subscription: Pick<WebhookSubscription, "id" | "expiresAt">
): string {
  const token = mintWebhookCallbackToken(subscription);
  return `${platformAppOrigin()}/api/webhooks/${encodeURIComponent(subscription.id)}?t=${token}`;
}

// ---------------------------------------------------------------------------
// The port the action calls.
// ---------------------------------------------------------------------------

/**
 * The action's port. Bound to the turn's **system** Db: the table has no member
 * insert policy, the runtime is the only writer.
 *
 * `simulated` records that the turn ran on an operator surface. Unlike a
 * review, the subscribe request is still sent: the point of testing a webhook
 * step in the Preview is to find out whether the other system accepts it.
 */
export function dbWebhookRuntime(
  db: Db,
  args: {
    conversation: Pick<Conversation, "id" | "metadata">;
    assistant: Pick<Assistant, "id" | "organizationId">;
    simulated: boolean;
  }
): WebhookRuntime {
  return {
    simulated: args.simulated,
    conversationId: args.conversation.id,
    callbackUrl: webhookCallbackUrl,
    async create(input) {
      const subscription = await db.table("webhookSubscriptions").insert({
        ...input,
        organizationId: args.assistant.organizationId,
        assistantId: args.assistant.id,
        conversationId: args.conversation.id,
        simulated: args.simulated,
      });
      await db.updateConversationMetadata(args.conversation.id, {
        ...args.conversation.metadata,
        pendingWebhookId: subscription.id,
      });
      return subscription;
    },
    async configureUnsubscribe(subscriptionId, call) {
      return db.table("webhookSubscriptions").update(subscriptionId, {
        unsubscribeMethod: call.method,
        unsubscribeUrl: call.url,
        unsubscribeBody: call.body,
      });
    },
    async fail(subscriptionId) {
      // A subscribe that never landed closes the gate from the pending state,
      // and only from there: nothing else can have happened to the row yet.
      await db.settleWebhookSubscription(subscriptionId, { status: "failed" });
      const fresh = await db.getConversation(args.conversation.id);
      if (fresh?.metadata.pendingWebhookId === subscriptionId) {
        await db.updateConversationMetadata(args.conversation.id, {
          ...fresh.metadata,
          pendingWebhookId: null,
        });
      }
    },
  };
}

/**
 * Stop the other system calling an endpoint whose turn is over. Best effort and
 * never fatal: the gate has already closed, and a Visitor must not be told
 * about a housekeeping call that failed. Stamped on the row either way, so a
 * subscription that leaked is visible rather than merely suspected.
 *
 * The URL and body were resolved and stored when the subscription was made.
 * The credential and headers are read from the Flow as it is *now*: a secret
 * on the row would be readable by every Member (the table has a select
 * policy), and an Editor who rotated the key during the wait means the new
 * one. A Flow deleted during the wait unsubscribes without a credential,
 * which is still better than not at all.
 */
async function unsubscribe(db: Db, subscription: WebhookSubscription): Promise<void> {
  if (!subscription.unsubscribeUrl || subscription.unsubscribedAt) return;
  try {
    const flow = await db.getFlow(subscription.flowId).catch(() => null);
    const configured = flow?.actionSettings?.http_webhook?.unsubscribe;
    await executeApiRequest(
      {
        method: (subscription.unsubscribeMethod ?? "DELETE") as WebhookCall["method"],
        url: subscription.unsubscribeUrl,
        bodyTemplate: subscription.unsubscribeBody ?? undefined,
        auth: configured?.auth,
        headers: configured?.headers,
      },
      webhookTemplateVariables(subscription)
    );
  } catch {
    /* housekeeping: the gate is already closed */
  }
  await db.table("webhookSubscriptions").update(subscription.id, {
    unsubscribedAt: new Date().toISOString(),
  });
}

/**
 * The exit nobody configured: a Conversation deleted while its gate is open.
 * The row cascades with the Conversation, so this runs *before* the delete
 * and does what the resumption job would have: tells the other system to
 * stop, and closes the row so a callback racing the delete finds a closed
 * gate rather than a pending one. Returns how many it closed.
 */
export async function unsubscribePendingWebhooks(
  deps: { db: Db },
  conversationId: string
): Promise<{ cancelled: number }> {
  const pending = await deps.db
    .table("webhookSubscriptions")
    .list({ conversationId, status: "pending" }, { limit: 100 });
  let cancelled = 0;
  for (const subscription of pending) {
    const closed = await deps.db.settleWebhookSubscription(subscription.id, {
      status: "expired",
    });
    if (!closed) continue;
    await unsubscribe(deps.db, closed);
    cancelled += 1;
  }
  return { cancelled };
}

// ---------------------------------------------------------------------------
// The callback.
// ---------------------------------------------------------------------------

export type WebhookDeliveryOutcome =
  | { ok: true; duplicate: boolean }
  | { ok: false; reason: "not_found" | "closed" };

/**
 * Apply a verified callback. The token got the caller this far; this decides
 * whether their body counts.
 *
 * A duplicate is answered `ok`, not refused: at-least-once delivery is normal,
 * and a caller told "conflict" retries harder. What it does not get is a second
 * continuation of the Flow.
 */
export async function deliverWebhookCallback(
  deps: { db: Db; now?: () => Date },
  subscriptionId: string,
  payload: string | null
): Promise<WebhookDeliveryOutcome> {
  const { db } = deps;
  const subscription = await db.table("webhookSubscriptions").get(subscriptionId);
  if (!subscription) return { ok: false, reason: "not_found" };
  const now = (deps.now ?? (() => new Date()))();
  const received = receiveWebhook(subscription, payload, now);
  if (!received) {
    // Already received, expired, failed, or past its wait with the sweep not
    // yet there. Only a received one is a duplicate worth acknowledging; the
    // others are a caller answering a closed gate.
    return subscription.status === "received"
      ? { ok: true, duplicate: true }
      : { ok: false, reason: "closed" };
  }
  // Persist what the transition decided, not a hand-copied subset of it, and
  // persist it as a compare-and-set: two callbacks racing both pass the read
  // above, and so does a callback racing the expiry sweep. The row is written
  // only while still pending, so exactly one of them lands. The loser reads
  // the row back and is answered as what it now is.
  const settled = await db.settleWebhookSubscription(subscription.id, {
    status: received.status,
    payload: received.payload,
    receivedAt: received.receivedAt,
  });
  if (!settled) {
    const fresh = await db.table("webhookSubscriptions").get(subscriptionId);
    return fresh?.status === "received"
      ? { ok: true, duplicate: true }
      : { ok: false, reason: "closed" };
  }
  // The job id is derived from the subscription, so the ledger's primary key
  // collapses a retried enqueue into one continuation.
  await enqueueWebhookResumptionJob({ db }, settled);
  return { ok: true, duplicate: false };
}

// ---------------------------------------------------------------------------
// The resumption job.
// ---------------------------------------------------------------------------

interface WebhookJobPayload {
  subscriptionId: string;
  organizationId: string;
}

export interface WebhookJobDeps {
  db: Db;
  now?: () => Date;
}

export async function enqueueWebhookResumptionJob(
  deps: { db: Db },
  subscription: Pick<WebhookSubscription, "id" | "organizationId">
): Promise<void> {
  await deps.db.createBackgroundJob({
    id: `${RESUME_WEBHOOK_KIND}:${subscription.id}`,
    organizationId: subscription.organizationId,
    kind: RESUME_WEBHOOK_KIND,
    payload: {
      subscriptionId: subscription.id,
      organizationId: subscription.organizationId,
    } satisfies WebhookJobPayload,
    maxAttempts: 3,
  });
  // Durable row first; the after-response drain is only an accelerator.
  getRuntimeHost().scheduleAfterResponse(async () => {
    const { runDueJobs } = await import("./jobs");
    await runDueJobs({ db: deps.db }, { kinds: [RESUME_WEBHOOK_KIND], limit: 5 });
  });
}

export const resumeWebhookConversationHandler: JobHandler = {
  async perform(record, deps) {
    const payload = record.payload as Partial<WebhookJobPayload>;
    if (!payload.subscriptionId) {
      throw nonRetryable("Invalid webhook resumption payload");
    }
    await resumeWebhookConversation({ db: deps.db }, payload.subscriptionId);
  },
};

/**
 * Continue (or close) the Conversation a settled subscription belongs to.
 * Idempotent: `resumedAt` is set once the message exists and the continuation
 * turn carries a stable turn id, so a retried claim replays rather than
 * answering twice.
 */
export async function resumeWebhookConversation(
  deps: WebhookJobDeps,
  subscriptionId: string
): Promise<void> {
  const { db } = deps;
  const subscription = await db.table("webhookSubscriptions").get(subscriptionId);
  if (!subscription || subscription.status === "pending") return;
  const conversation = await db.getConversation(subscription.conversationId);
  if (!conversation) return;
  if (subscription.resumedAt) return;

  // Unsubscribe before continuing: the Flow's remaining actions may take a
  // while, and the other system has nothing left to tell us either way.
  await unsubscribe(db, subscription);

  if (subscription.status === "received") {
    const resumed = await resumeGateTurn({
      db, conversation, gate: { kind: "webhook", request: subscription },
    });
    if (!resumed) {
      return;
    }
  } else {
    const closed: ChatReplyPart[] = [
      { type: "text", action: "http_webhook", text: webhookHaltMessage(subscription) },
    ];
    await db.appendMessage({
      conversationId: conversation.id,
      requestId: `webhook-${subscription.id}-halt`,
      role: "assistant",
      content: closed,
      flowId: subscription.flowId,
    });
  }

  const now = (deps.now ?? (() => new Date()))().toISOString();
  await db.table("webhookSubscriptions").update(subscription.id, { resumedAt: now });
  const fresh = await db.getConversation(conversation.id);
  if (fresh?.metadata.pendingWebhookId === subscription.id) {
    await db.updateConversationMetadata(conversation.id, {
      ...fresh.metadata,
      pendingWebhookId: null,
    });
  }
}

/**
 * What the actions after the gate may interpolate: the core variables, plus
 * whatever the settings' JSON paths pull out of the callback body. The same
 * reader `api_request` uses, so "extract `$.data.id` into `{{id}}`" means one
 * thing in this product.
 */
export function webhookResumeVariables(
  subscription: WebhookSubscription,
  settings: FlowActionSettings["http_webhook"]
): Record<string, string> {
  const vars = webhookTemplateVariables(subscription);
  if (!settings?.jsonPaths?.length) return vars;
  const { extracted } = extractApiJsonPaths(
    { jsonPaths: settings.jsonPaths },
    subscription.payload
  );
  for (const value of extracted) vars[value.variable] = value.value;
  return vars;
}

// ---------------------------------------------------------------------------
// The clock.
// ---------------------------------------------------------------------------

/**
 * pending + overdue then expired, followed by the halt path. Reads pending rows
 * and decides in memory, because the number of open gates at any moment is
 * small by construction (each one holds a Conversation).
 */
export async function expireDueWebhooks(deps: WebhookJobDeps): Promise<{ expired: number }> {
  const now = (deps.now ?? (() => new Date()))();
  const pending = await deps.db
    .table("webhookSubscriptions")
    .list({ status: "pending" }, { limit: 500 });
  let expired = 0;
  for (const subscription of pending) {
    const overdue = expireWebhook(subscription, now);
    if (!overdue) continue;
    // Compare-and-set: a callback that landed between the list above and this
    // write has already closed the row, and the sweep must not flip it back to
    // expired under the continuation's feet and drop the payload.
    const settled = await deps.db.settleWebhookSubscription(subscription.id, {
      status: overdue.status,
    });
    if (!settled) continue;
    await enqueueWebhookResumptionJob(deps, settled);
    expired += 1;
  }
  return { expired };
}

/** The cron tick: expire what is overdue, then drain the resumption job. */
export async function runDueWebhookJobs(deps: WebhookJobDeps): Promise<{
  expired: number;
  claimed: number;
  succeeded: number;
  failed: number;
}> {
  const { expired } = await expireDueWebhooks(deps);
  const { runDueJobs } = await import("./jobs");
  const result = await runDueJobs(
    { db: deps.db },
    { kinds: [RESUME_WEBHOOK_KIND], now: (deps.now ?? (() => new Date()))(), limit: 20 }
  );
  return {
    expired,
    claimed: result.claimed,
    succeeded: result.succeeded,
    failed: result.failed,
  };
}
