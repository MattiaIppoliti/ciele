/**
 * The one email transport seam. Every outbound email, the `send_email` Flow
 * Action effect, the widget escalation email channel, and the Improvement
 * assign/close notifications, goes through `sendEmail`, so the provider is
 * a single edit here, not one per caller.
 *
 * Provider: Resend's HTTP API called with `fetch` (no SDK dependency).
 * Configured via `RESEND_API_KEY` + `EMAIL_FROM`. Without both, `sendEmail`
 * reports `not_configured` instead of throwing, callers decide how to be
 * honest about it (the escalation route falls back to a mailto link; the
 * send_email action emits "couldn't forward" copy). A failing send never
 * breaks a chat turn: effects isolate errors, and this function never throws.
 */
export interface EmailMessage {
  /** One address, or several comma-separated. */
  to: string;
  subject: string;
  /**
   * The plain-text part, and the only required one. Every message keeps it
   * even when `html` is set: it is the copy a text-only client renders, and a
   * message with no text part scores worse with spam filters than one with.
   */
  body: string;
  /**
   * Optional HTML part. Set it for the messages a human reads on the public
   * site (the newsletter confirmation); operational mail to a help desk stays
   * text, where the content is the payload and markup only gets in the way.
   */
  html?: string;
  replyTo?: string;
}

export type EmailDelivery =
  | { delivered: true }
  | { delivered: false; reason: "not_configured" | "send_failed" };

export type EmailTransport = (message: EmailMessage) => Promise<EmailDelivery>;

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** True when the transport can actually deliver (used for honest chat copy). */
export function emailTransportConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export async function sendEmail(message: EmailMessage): Promise<EmailDelivery> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    console.warn(
      `[email] transport not configured, would send to ${message.to}: "${message.subject}"`
    );
    return { delivered: false, reason: "not_configured" };
  }
  const to = message.to
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean);
  if (to.length === 0) return { delivered: false, reason: "send_failed" };
  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from,
        to,
        subject: message.subject,
        text: message.body,
        ...(message.html ? { html: message.html } : {}),
        ...(message.replyTo ? { reply_to: message.replyTo } : {}),
      }),
    });
    if (!response.ok) {
      console.error(
        `[email] send to ${message.to} failed: ${response.status} ${await response
          .text()
          .then((t) => t.slice(0, 200))
          .catch(() => "")}`
      );
      return { delivered: false, reason: "send_failed" };
    }
    return { delivered: true };
  } catch (error) {
    console.error(`[email] send to ${message.to} failed:`, error);
    return { delivered: false, reason: "send_failed" };
  }
}
