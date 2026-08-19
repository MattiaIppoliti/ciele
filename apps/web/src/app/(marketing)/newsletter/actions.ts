"use server";

import { headers } from "next/headers";
import { sendEmail } from "@agent-hub/agent";
import { clientAddress, createRateLimiter } from "@/lib/rate-limit";
import { addNewsletterContact } from "@/lib/marketing/newsletter-audience";
import {
  confirmationSigningConfigured,
  mintConfirmationToken,
  newsletterConfirmationEmail,
  validateNewsletterEmail,
  verifyConfirmationToken,
} from "@/lib/marketing/newsletter";

/**
 * The two halves of the newsletter double opt-in.
 *
 * Halves, not one step, and that is the point: the footer form only ever
 * causes an email to the address that was typed. Nothing joins the list until
 * the owner of that mailbox clicks through, so typing a stranger's address
 * into the footer subscribes nobody and mails them exactly once.
 *
 * The second half is a Server Action rather than a GET handler on the confirm
 * link. Corporate mail scanners fetch every URL in an inbound message; if the
 * link itself completed the subscription, Defender would be confirming
 * subscriptions on the recipient's behalf. The link renders a page with a
 * button, and the button posts.
 */

/** Two sign-ups per address-space per ten minutes. A human types one. */
const limiter = createRateLimiter({ limit: 2, windowMs: 10 * 60 * 1000 });

export type SubscribeResult =
  | { status: "check_inbox" }
  | { status: "invalid"; error: string }
  | { status: "rate_limited"; retryAfterSeconds: number }
  /** Transport or signing key unconfigured, or the send failed. Never claim success. */
  | { status: "unavailable" };

export interface SubscribeInput {
  email: string;
  /** Honeypot, mirroring the contact-sales form. A human never fills it. */
  organizationReference?: string;
}

/**
 * Builds the absolute confirm URL from the request. There is no canonical
 * origin env var in this app, and inventing one for a single link would be one
 * more config item to get wrong per environment.
 */
function confirmUrl(requestHeaders: Headers, token: string): string {
  const host = requestHeaders.get("host") ?? "platform.ciele.app";
  const proto =
    requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  const url = new URL(`${proto}://${host}/newsletter/confirm`);
  url.searchParams.set("token", token);
  return url.toString();
}

export async function subscribeToNewsletterAction(
  input: SubscribeInput
): Promise<SubscribeResult> {
  // Honeypot tripped: report success without sending, so the bot learns nothing.
  if (input.organizationReference?.trim()) return { status: "check_inbox" };

  const validation = validateNewsletterEmail(input.email);
  if (!validation.ok) return { status: "invalid", error: validation.error };

  const requestHeaders = await headers();
  const decision = limiter.check(`newsletter:${clientAddress(requestHeaders)}`);
  if (!decision.allowed) {
    return {
      status: "rate_limited",
      retryAfterSeconds: Math.max(1, Math.ceil(decision.retryAfterMs / 1000)),
    };
  }

  if (!confirmationSigningConfigured()) {
    console.error(
      "[newsletter] APP_ENCRYPTION_KEY is unset, cannot sign a confirmation link"
    );
    return { status: "unavailable" };
  }

  const token = mintConfirmationToken(validation.email);
  const delivery = await sendEmail(
    newsletterConfirmationEmail({
      to: validation.email,
      confirmUrl: confirmUrl(requestHeaders, token),
    })
  );
  if (!delivery.delivered) {
    console.error(`[newsletter] confirmation not sent: ${delivery.reason}`);
    return { status: "unavailable" };
  }

  return { status: "check_inbox" };
}

export type ConfirmResult =
  | { status: "subscribed" }
  | { status: "expired" }
  | { status: "invalid" }
  | { status: "unavailable" };

/**
 * Completes the opt-in. Re-verifies the token instead of trusting whatever the
 * page decided a moment ago: the page's verdict is a rendering hint, this is
 * the check that holds.
 */
export async function confirmNewsletterAction(token: string): Promise<ConfirmResult> {
  const verified = verifyConfirmationToken(token);
  if (!verified.ok) {
    if (verified.reason === "expired") return { status: "expired" };
    // No signing key is our failure, not a bad link: do not tell the visitor
    // their link is invalid and send them round the loop again.
    if (verified.reason === "unconfigured") {
      console.error("[newsletter] APP_ENCRYPTION_KEY is unset, cannot verify a confirmation link");
      return { status: "unavailable" };
    }
    return { status: "invalid" };
  }

  const result = await addNewsletterContact(verified.email);
  if (!result.added) {
    console.error(`[newsletter] not subscribed: ${result.reason}`);
    return { status: "unavailable" };
  }
  return { status: "subscribed" };
}
