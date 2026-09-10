import type { HttpWebhookSettings, WebhookCall, WebhookSubscription } from "./types";

/**
 * The callback gate's state machine (#842), as pure functions over the
 * `WebhookSubscription` row.
 *
 * pending → received (the first callback) | expired (the clock) | failed (the
 * subscribe call never landed). Every transition is decided here and enforced
 * in the runtime, so the public callback route, the expiry sweep and the
 * resumption job cannot disagree about which callback counts.
 *
 * The same shape as the Human review gate (#841) with a machine in the middle
 * instead of a person. The difference that matters is who may close it: a
 * review is closed by an authenticated Member, a subscription by an
 * unauthenticated caller holding a signed URL. So "the first one wins" is not
 * a courtesy here, it is the whole protection against a retrying or replaying
 * caller running the rest of the Flow twice.
 */

/** A callback that has not arrived in fifteen minutes is usually not coming. */
export const DEFAULT_WEBHOOK_TIMEOUT_MINUTES = 15;
export const MIN_WEBHOOK_TIMEOUT_MINUTES = 1;
/** A day. Beyond this the Conversation holding the gate is the problem. */
export const MAX_WEBHOOK_TIMEOUT_MINUTES = 24 * 60;
/**
 * How much of a callback body is kept. The actions after the gate extract from
 * it, they do not archive it, and the row sits in a table read on every sweep.
 */
export const WEBHOOK_PAYLOAD_MAX_CHARS = 32_000;

/** The template variable a subscribe call uses to say where to call back. */
export const WEBHOOK_CALLBACK_TOKEN = "{{webhook.callbackUrl}}";

export const DEFAULT_WEBHOOK_WAITING_MESSAGE =
  "I've asked for that and I'm waiting on the answer.";
const DEFAULT_EXPIRED_MESSAGE = "I didn't hear back in time, so I've stopped waiting.";
const DEFAULT_FAILED_MESSAGE = "I couldn't reach that system just now.";

/** Minutes the gate waits: the configured value, floored, capped, defaulted. */
export function webhookTimeoutMinutes(
  settings: Pick<HttpWebhookSettings, "timeoutMinutes">
): number {
  const raw = Number(settings.timeoutMinutes);
  if (!Number.isFinite(raw) || raw < MIN_WEBHOOK_TIMEOUT_MINUTES) {
    return DEFAULT_WEBHOOK_TIMEOUT_MINUTES;
  }
  return Math.min(Math.floor(raw), MAX_WEBHOOK_TIMEOUT_MINUTES);
}

export function webhookExpiresAt(createdAt: Date, timeoutMinutes: number): string {
  return new Date(createdAt.getTime() + timeoutMinutes * 60_000).toISOString();
}

export function isWebhookOverdue(
  subscription: Pick<WebhookSubscription, "status" | "expiresAt">,
  now: Date
): boolean {
  return (
    subscription.status === "pending" && Date.parse(subscription.expiresAt) <= now.getTime()
  );
}

/** The row as it should be stored once overdue, or null when it is not. */
export function expireWebhook(
  subscription: WebhookSubscription,
  now: Date
): WebhookSubscription | null {
  if (!isWebhookOverdue(subscription, now)) return null;
  return { ...subscription, status: "expired", updatedAt: now.toISOString() };
}

/**
 * The first callback, or null when the gate is already closed.
 *
 * Returning null rather than throwing is deliberate: a second callback is a
 * normal thing for a caller to send (an at-least-once delivery, a retry after
 * a timeout it did not see answered), and the route answers it with a plain
 * acknowledgement. What must not happen is the Flow continuing twice.
 *
 * A callback after `expiresAt` is refused too, whether or not the expiry sweep
 * has run yet. The sweep is a clock that ticks hourly at best and daily on the
 * hosted plan, and the wait the author configured is the promise made to the
 * Visitor; a late answer resuming the Flow because the sweep had not got to
 * the row would make the timeout a suggestion.
 */
export function receiveWebhook(
  subscription: WebhookSubscription,
  payload: string | null,
  now: Date
): WebhookSubscription | null {
  if (subscription.status !== "pending") return null;
  if (isWebhookOverdue(subscription, now)) return null;
  return {
    ...subscription,
    status: "received",
    payload: cappedWebhookPayload(payload),
    receivedAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

/** A callback body trimmed to what the row keeps. */
export function cappedWebhookPayload(payload: string | null): string {
  return (payload ?? "").slice(0, WEBHOOK_PAYLOAD_MAX_CHARS);
}

/**
 * What the Flow's remaining actions may interpolate after the gate. The body
 * is offered whole under `webhook.body`; named values come from the settings'
 * JSON paths, which the runtime extracts with the same reader `api_request`
 * uses.
 */
export function webhookTemplateVariables(
  subscription: Pick<WebhookSubscription, "status" | "payload" | "receivedAt">
): Record<string, string> {
  return {
    "webhook.status": subscription.status,
    "webhook.received": subscription.status === "received" ? "true" : "false",
    "webhook.body": subscription.payload ?? "",
    "webhook.receivedAt": subscription.receivedAt ?? "",
  };
}

/** What the Visitor reads when the gate closes without a callback. */
export function webhookHaltMessage(
  subscription: Pick<WebhookSubscription, "status" | "haltMessage">
): string {
  const configured = subscription.haltMessage?.trim();
  if (configured) return configured;
  return subscription.status === "failed" ? DEFAULT_FAILED_MESSAGE : DEFAULT_EXPIRED_MESSAGE;
}

/** Whether a configured call names a URL this build could actually request. */
function callUrlIssue(call: WebhookCall | undefined, label: string): string | null {
  const url = call?.url?.trim();
  if (!url) return `Give the ${label} call a URL.`;
  // Template variables are allowed anywhere in the URL, so validate the shape
  // with them stubbed out, exactly as the request itself will.
  try {
    new URL(url.replace(/\{\{[^}]+\}\}/g, "x"));
  } catch {
    return `The ${label} URL is not a valid URL.`;
  }
  return null;
}

/**
 * The Needs-setup rule the canvas, the form and Publish share. `null` means
 * configured.
 */
export function httpWebhookSettingsIssue(
  settings: HttpWebhookSettings | undefined
): string | null {
  if (!settings) return "The HTTP webhook is not configured.";
  const subscribeIssue = callUrlIssue(settings.subscribe, "subscribe");
  if (subscribeIssue) return subscribeIssue;
  if (settings.unsubscribe?.url?.trim()) {
    const unsubscribeIssue = callUrlIssue(settings.unsubscribe, "unsubscribe");
    if (unsubscribeIssue) return unsubscribeIssue;
  }
  // Without the callback URL somewhere in the subscribe request, the other
  // system has no way to answer and the gate can only ever expire. Cheap to
  // check here, and the alternative is a Flow that looks configured and waits
  // fifteen minutes to prove it is not.
  const carries = `${settings.subscribe?.url ?? ""} ${settings.subscribe?.bodyTemplate ?? ""}`;
  if (!carries.includes(WEBHOOK_CALLBACK_TOKEN)) {
    return `Put ${WEBHOOK_CALLBACK_TOKEN} in the subscribe URL or body, so the other system knows where to call back.`;
  }
  return null;
}
