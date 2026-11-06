import { OUTBOUND_WEBHOOK_EVENTS, OUTBOUND_WEBHOOK_EXAMPLES, isOutboundWebhookEventType } from "@agent-hub/core";

/** Render the shipping event declarations and samples, rather than a second schema. */
export function WebhookEvents() {
  return Object.keys(OUTBOUND_WEBHOOK_EVENTS).filter(isOutboundWebhookEventType).map((type) => <section key={type}>
    <h3><code>{type}</code></h3>
    <dl>{Object.entries(OUTBOUND_WEBHOOK_EVENTS[type]).map(([name, field]) => <div key={name}>
      <dt><code>{name}</code></dt><dd><code>{typeof field === "string" ? field : field.join(" | ")}</code></dd>
    </div>)}</dl>
    <pre><code>{JSON.stringify({ id: "event-example", type, createdAt: "2026-10-22T10:00:00.000Z", organizationId: "organization-example", data: OUTBOUND_WEBHOOK_EXAMPLES[type] }, null, 2)}</code></pre>
  </section>);
}
