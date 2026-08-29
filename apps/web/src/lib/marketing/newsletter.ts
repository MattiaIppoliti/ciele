import { createHmac, timingSafeEqual } from "crypto";
import type { EmailMessage } from "@agent-hub/agent";
import { renderBrandedEmail } from "./email-layout";

/**
 * The newsletter double opt-in, as a pure module.
 *
 * **No table, no row.** The pending subscription is the signed token in the
 * confirmation link, not a database record. That is the same call the
 * contact-sales action made and for the same reason: an unconfirmed address is
 * write-only PII, and persisting it would need an anonymous INSERT policy on a
 * public table plus a sweep for the ones nobody ever confirms. A token that
 * carries its own expiry needs neither. The address only becomes durable state
 * when the human proves they own it, and then it lives in the Resend Audience
 * (see newsletter-audience.ts), which is also what sends to it and honours the
 * unsubscribe.
 *
 * The signing key is derived from `APP_ENCRYPTION_KEY` with a domain-separation
 * label, so there is no second secret to provision and a newsletter token can
 * never be mistaken for a sealed provider key. Without that env var nothing can
 * be signed and `mintConfirmationToken` throws — the action turns that into an
 * honest "unavailable" rather than minting a forgeable link.
 */

/** RFC 5321's ceiling; anything longer is a bot, not a mailbox. */
export const NEWSLETTER_EMAIL_MAX = 254;

/** How long a confirmation link stays valid. Long enough for a mailbox left until Monday. */
export const CONFIRMATION_TTL_MS = 48 * 60 * 60 * 1000;

/** Deliberately loose, matching lib/contact/sales-lead.ts: one `@`, no whitespace, a dot in the domain. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type EmailValidation =
  | { ok: true; email: string }
  | { ok: false; error: string };

/**
 * Validates and normalises a posted address. Lower-cased so the same mailbox
 * cannot enter the Audience twice under different capitalisation.
 */
export function validateNewsletterEmail(raw: unknown): EmailValidation {
  const email = (typeof raw === "string" ? raw : "").trim().toLowerCase();
  if (!email) return { ok: false, error: "Enter your email address." };
  if (email.length > NEWSLETTER_EMAIL_MAX)
    return { ok: false, error: "That address is too long." };
  if (!EMAIL_RE.test(email))
    return { ok: false, error: "That does not look like an email address." };
  return { ok: true, email };
}

function signingKey(): Buffer {
  const secret = process.env.APP_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error(
      "APP_ENCRYPTION_KEY is not set — required to sign newsletter confirmation links."
    );
  }
  // Domain separation: this key signs opt-in tokens and nothing else.
  return createHmac("sha256", secret).update("newsletter-confirm-v1").digest();
}

function base64url(value: Buffer | string): string {
  return Buffer.from(value).toString("base64url");
}

function sign(payload: string): string {
  return createHmac("sha256", signingKey()).update(payload).digest("base64url");
}

/** True when a confirmation link can be signed at all. */
export function confirmationSigningConfigured(): boolean {
  return Boolean(process.env.APP_ENCRYPTION_KEY);
}

/**
 * Mints the token that rides in the confirmation link: `<payload>.<hmac>`,
 * where the payload is `<expiry ms>:<email>`. The expiry is inside the signed
 * material, so an attacker cannot extend a link they received.
 */
export function mintConfirmationToken(
  email: string,
  options: { now?: Date; ttlMs?: number } = {}
): string {
  const now = options.now ?? new Date();
  const ttl = options.ttlMs ?? CONFIRMATION_TTL_MS;
  const payload = base64url(`${now.getTime() + ttl}:${email}`);
  return `${payload}.${sign(payload)}`;
}

export type TokenVerification =
  | { ok: true; email: string }
  /**
   * `unconfigured` is not a verdict on the token: with no signing key nothing
   * can be checked, and calling that link "invalid" would tell a visitor to
   * re-subscribe into the same wall. Callers report it as a service failure.
   */
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" | "unconfigured" };

/**
 * Verifies a confirmation token. Signature first, expiry second: an unsigned
 * token's expiry is not evidence of anything, and comparing the digests with
 * `timingSafeEqual` keeps the check off the timing side channel.
 */
export function verifyConfirmationToken(
  token: unknown,
  options: { now?: Date } = {}
): TokenVerification {
  if (typeof token !== "string" || !token.includes("."))
    return { ok: false, reason: "malformed" };
  // Checked before signing so a missing key surfaces as a service failure
  // rather than a 500 from `signingKey()` on a page reached from an inbox.
  if (!confirmationSigningConfigured()) return { ok: false, reason: "unconfigured" };
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return { ok: false, reason: "malformed" };

  const expected = Buffer.from(sign(payload));
  const provided = Buffer.from(signature);
  if (
    expected.length !== provided.length ||
    !timingSafeEqual(expected, provided)
  ) {
    return { ok: false, reason: "bad_signature" };
  }

  const decoded = Buffer.from(payload, "base64url").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator < 1) return { ok: false, reason: "malformed" };
  const expiresAt = Number(decoded.slice(0, separator));
  const email = decoded.slice(separator + 1);
  if (!Number.isFinite(expiresAt) || !email)
    return { ok: false, reason: "malformed" };
  if ((options.now ?? new Date()).getTime() > expiresAt)
    return { ok: false, reason: "expired" };

  return { ok: true, email };
}

/**
 * The one email this flow sends, in both parts.
 *
 * The text part is not a courtesy copy: it is what a text-only client shows
 * and what keeps a single-link message out of the spam folder. The HTML part
 * wears the site's shell (see email-layout.ts).
 */
export function newsletterConfirmationEmail(input: {
  to: string;
  confirmUrl: string;
}): EmailMessage {
  const heading = "Confirm your subscription";
  const lead =
    "Someone (we hope you) asked for the Ciele newsletter with this address.";
  const ignore =
    "If this was not you, ignore this email. Nothing was subscribed, and we will not write again.";
  const expiry = "The link works for 48 hours.";

  return {
    to: input.to,
    subject: "Confirm your Ciele newsletter subscription",
    body: [lead, "", "Confirm the subscription:", input.confirmUrl, "", expiry, ignore].join(
      "\n"
    ),
    html: renderBrandedEmail({
      preheader: "One click and you are on the list.",
      heading,
      paragraphs: [lead, "Press the button and we will start sending it here."],
      cta: { label: "Confirm subscription", url: input.confirmUrl },
      showUrlFallback: true,
      footnotes: [expiry, ignore],
    }),
  };
}
