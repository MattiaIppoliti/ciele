/**
 * The public outbound-event contract (#1099, #1100). Field declarations drive
 * TypeScript data types, boundary validation and the public documentation.
 * Explicit field lists also keep Visitor text out of the transport envelope.
 */
type Field = "string" | "number" | "nullable-string" | readonly string[];

export const OUTBOUND_WEBHOOK_EVENTS = {
  "conversation.escalated": {
    conversationId: "string",
    conversationName: "string",
    assistantId: "string",
    assistantName: "string",
    helpDeskId: "string",
    helpDeskName: "string",
    channelId: "nullable-string",
    channelName: "nullable-string",
    inboxUrl: "string",
  },
  "improvement.created": {
    id: "string",
    title: "string",
    source: ["flow_action", "escalation", "manual", "system"],
    assistantId: "nullable-string",
  },
  "feedback.negative": {
    conversationId: "string",
    messageId: "string",
    assistantId: "string",
  },
  "alert.raised": { id: "string", type: "string", title: "string" },
  "alert.resolved": { id: "string", type: "string", title: "string" },
  "publication.created": {
    assistantId: "string",
    version: "number",
    publishedBy: "nullable-string",
  },
} as const satisfies Record<string, Record<string, Field>>;

export type OutboundWebhookEventType = keyof typeof OUTBOUND_WEBHOOK_EVENTS;
type FieldValue<F extends Field> = F extends "number" ? number
  : F extends "nullable-string" ? string | null
    : F extends readonly string[] ? F[number] : string;

export type OutboundWebhookData<T extends OutboundWebhookEventType> = {
  [K in keyof (typeof OUTBOUND_WEBHOOK_EVENTS)[T]]:
    (typeof OUTBOUND_WEBHOOK_EVENTS)[T][K] extends Field
      ? FieldValue<(typeof OUTBOUND_WEBHOOK_EVENTS)[T][K]> : never;
};

export type OutboundWebhookEvent = {
  [T in OutboundWebhookEventType]: {
    id: string;
    type: T;
    createdAt: string;
    organizationId: string;
    data: OutboundWebhookData<T>;
  }
}[OutboundWebhookEventType];

/** Synthetic data for the docs and the subscription's Send test event action. */
export const OUTBOUND_WEBHOOK_EXAMPLES = {
  "conversation.escalated": {
    conversationId: "conversation-example", conversationName: "Conversation conversation-example",
    assistantId: "assistant-example", assistantName: "Support Assistant",
    helpDeskId: "desk-example", helpDeskName: "IT Help Desk",
    channelId: "channel-example", channelName: "Email", inboxUrl: "https://ciele.app/inbox?conversation=conversation-example",
  },
  "improvement.created": { id: "improvement-example", title: "Review support instructions", source: "manual", assistantId: "assistant-example" },
  "feedback.negative": { conversationId: "conversation-example", messageId: "message-example", assistantId: "assistant-example" },
  "alert.raised": { id: "alert-example", type: "integration", title: "Check the integration" },
  "alert.resolved": { id: "alert-example", type: "integration", title: "Check the integration" },
  "publication.created": { assistantId: "assistant-example", version: 2, publishedBy: "member-example" },
} satisfies { [T in OutboundWebhookEventType]: OutboundWebhookData<T> };

export function isOutboundWebhookEventType(value: string): value is OutboundWebhookEventType {
  return Object.hasOwn(OUTBOUND_WEBHOOK_EVENTS, value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Strict on unknown fields: a producer cannot accidentally include text. */
export function isOutboundWebhookEvent(value: unknown): value is OutboundWebhookEvent {
  if (!isRecord(value) || Object.keys(value).length !== 5) return false;
  if (typeof value.id !== "string" || !value.id ||
    typeof value.organizationId !== "string" || !value.organizationId ||
    typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt)) ||
    typeof value.type !== "string" || !isOutboundWebhookEventType(value.type) ||
    !isRecord(value.data)) return false;
  const fields: Record<string, Field> = OUTBOUND_WEBHOOK_EVENTS[value.type];
  const data = value.data;
  return Object.keys(fields).length === Object.keys(data).length &&
    Object.entries(fields).every(([key, field]) => {
      const item = data[key];
      if (field === "number") return typeof item === "number" && Number.isFinite(item);
      if (field === "nullable-string") return item === null || typeof item === "string";
      if (field === "string") return typeof item === "string";
      return typeof item === "string" && field.some((allowed) => allowed === item);
    });
}

/** Exponential retries, capped at an hour, within the event's 24-hour window. */
export function outboundWebhookRetryAt(createdAt: string, attempts: number, now: Date): Date | null {
  const deadline = Date.parse(createdAt) + 24 * 60 * 60_000;
  const delay = Math.min(60_000 * 2 ** Math.max(0, attempts - 1), 60 * 60_000);
  const next = now.getTime() + delay;
  return Number.isFinite(deadline) && next < deadline ? new Date(next) : null;
}

export interface OutboundWebhookSubscription {
  id: string;
  organizationId: string;
  name: string;
  url: string;
  eventTypes: OutboundWebhookEventType[];
  paused: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookDelivery {
  id: string;
  organizationId: string;
  subscriptionId: string;
  event: OutboundWebhookEvent;
  attempts: number;
  status: "queued" | "delivered" | "failed";
  lastStatusCode: number | null;
  lastAttemptAt: string | null;
  createdAt: string;
}
