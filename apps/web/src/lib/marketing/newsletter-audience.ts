/**
 * The confirmed side of the newsletter: the Resend Audience.
 *
 * A confirmed address is the only newsletter state this app keeps, and it does
 * not keep it — Resend does. The Audience is what a broadcast sends to and what
 * owns the unsubscribe link required in every marketing send, so mirroring it
 * into Postgres would create a second list that drifts out of date the first
 * time somebody unsubscribes.
 *
 * Configured with `RESEND_API_KEY` (already required by the email transport)
 * plus `RESEND_AUDIENCE_ID`. Missing either one reports `not_configured`
 * instead of throwing, the same contract as `sendEmail` — the confirm page then
 * tells the visitor the truth rather than thanking them for nothing.
 */

const RESEND_AUDIENCES = "https://api.resend.com/audiences";

export type ContactResult =
  | { added: true }
  | { added: false; reason: "not_configured" | "failed" };

/** True when a confirmed address can actually reach the list. */
export function newsletterAudienceConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_AUDIENCE_ID);
}

/**
 * Adds a confirmed address to the Audience. Never throws: a failure here must
 * not become a 500 on a page the visitor reached from their inbox.
 *
 * Re-confirming an address already on the list is a no-op Resend answers 2xx,
 * so a visitor who clicks the link twice sees success both times. One case it
 * does not cover: an address that previously unsubscribed stays unsubscribed,
 * because re-adding a contact does not flip that flag. Honouring a fresh opt-in
 * for a past unsubscriber needs a PATCH, and doing that automatically is how a
 * suppression list gets defeated, so it stays manual.
 */
export async function addNewsletterContact(email: string): Promise<ContactResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const audienceId = process.env.RESEND_AUDIENCE_ID;
  if (!apiKey || !audienceId) {
    console.warn(`[newsletter] audience not configured — would subscribe ${email}`);
    return { added: false, reason: "not_configured" };
  }
  try {
    const response = await fetch(
      `${RESEND_AUDIENCES}/${encodeURIComponent(audienceId)}/contacts`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ email, unsubscribed: false }),
      }
    );
    if (!response.ok) {
      console.error(
        `[newsletter] subscribe failed: ${response.status} ${await response
          .text()
          .then((body) => body.slice(0, 200))
          .catch(() => "")}`
      );
      return { added: false, reason: "failed" };
    }
    return { added: true };
  } catch (error) {
    console.error("[newsletter] subscribe failed:", error);
    return { added: false, reason: "failed" };
  }
}
