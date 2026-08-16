"use server";

import { headers } from "next/headers";
import { sendEmail } from "@agent-hub/agent";
import { clientAddress, createRateLimiter } from "@/lib/rate-limit";
import {
  salesInboxAddress,
  salesLeadEmail,
  validateSalesLead,
  type SalesLeadErrors,
  type SalesLeadSubmission,
} from "@/lib/contact/sales-lead";

/**
 * The public contact-sales submission.
 *
 * **Destination: an email to the sales alias, not a row.** This is the only
 * inbound sales path on the marketing site and it is the only unauthenticated
 * write in the app, which decided it both ways. A lead table would need an
 * anonymous INSERT policy on a public table (a spam sink with an RLS hole
 * shaped like a funnel), a retention sweep, and an admin surface to read it —
 * none of which exist, so the row would be write-only PII. The mailbox is
 * already the place a human works leads, `sendEmail` (Resend) is already the
 * one transport, and the message carries the consent value and its timestamp,
 * so the record of consent is the artefact that also gets acted on. Persisting
 * becomes worth it when there is a CRM or an admin inbox to read the rows.
 *
 * Because delivery can fail, this action reports what happened and the form
 * only shows "Thank you" on `sent` — the old unconditional panel claimed
 * receipt for submissions that went nowhere.
 */

export type ContactSalesResult =
  | { status: "sent" }
  | { status: "invalid"; errors: SalesLeadErrors }
  | { status: "rate_limited"; retryAfterSeconds: number }
  /** Transport unconfigured or the send failed — never claim receipt. */
  | { status: "unavailable" };

/** Three enquiries per address per ten minutes is far above human behaviour. */
const limiter = createRateLimiter({ limit: 3, windowMs: 10 * 60 * 1000 });

export interface ContactSalesInput extends SalesLeadSubmission {
  /**
   * Honeypot. Rendered off-screen, `tabindex=-1`, `autocomplete="off"`, and
   * labelled "leave this empty" — a human never fills it, a form-filling bot
   * usually does.
   */
  organizationReference?: string;
}

export async function submitSalesEnquiryAction(
  input: ContactSalesInput
): Promise<ContactSalesResult> {
  // Honeypot tripped: report success without sending. Telling a bot it was
  // caught only teaches it which field to skip, and no human is misled.
  if (input.organizationReference?.trim()) return { status: "sent" };

  // Validation runs before the limiter on purpose: it is pure and cheap, and
  // counting rejected posts would let two typos exhaust a real visitor's
  // budget. The limiter exists to bound *deliveries*, not CPU.
  const validation = validateSalesLead(input);
  if (!validation.ok) return { status: "invalid", errors: validation.errors };

  const requestHeaders = await headers();
  const decision = limiter.check(`contact-sales:${clientAddress(requestHeaders)}`);
  if (!decision.allowed) {
    return {
      status: "rate_limited",
      retryAfterSeconds: Math.max(1, Math.ceil(decision.retryAfterMs / 1000)),
    };
  }

  const to = salesInboxAddress();
  if (!to) {
    console.error(
      "[contact-sales] CONTACT_SALES_EMAIL is unset — enquiry not delivered"
    );
    return { status: "unavailable" };
  }

  const delivery = await sendEmail(
    salesLeadEmail(validation.lead, {
      to,
      sourceUrl: requestHeaders.get("referer") ?? undefined,
    })
  );
  if (!delivery.delivered) {
    console.error(`[contact-sales] enquiry not delivered: ${delivery.reason}`);
    return { status: "unavailable" };
  }

  return { status: "sent" };
}
