import type { EmailMessage } from "@agent-hub/agent";

/**
 * The contact-sales lead: its option vocabulary, its server-side validation and
 * the email that carries it.
 *
 * The destination for a submission is **an email to the sales alias**, not a
 * database row (see `app/(marketing)/contact/sales/actions.ts` for why). That makes this
 * module the whole domain: a pure record → validated lead → `EmailMessage`
 * pipeline with no I/O, which is also why it is testable as plain TS while the
 * form itself is a `.tsx` the vitest include never picks up.
 *
 * The three option lists are exported for the form to render *and* for the
 * action to validate against — a select is a client-side suggestion, never a
 * guarantee about what arrives.
 */

export const SALES_COUNTRIES = [
  "Italy",
  "United Kingdom",
  "United States",
  "France",
  "Germany",
  "Spain",
  "Netherlands",
  "Switzerland",
  "Other",
] as const;

export const SALES_COMPANY_SIZES = [
  "1 to 500",
  "501 to 2,000",
  "2,001 to 10,000",
  "10,001 to 30,000",
  "30,000+",
] as const;

export const SALES_PRODUCT_INTERESTS = [
  "Customer support assistants",
  "Internal knowledge assistants",
  "Help desk & escalation",
  "Knowledge & content ingestion",
  "Analytics & insights",
  "Other",
] as const;

/** What the form posts. Every field is a string so a forged post can't smuggle a type. */
export interface SalesLeadSubmission {
  email: string;
  name: string;
  phone: string;
  country: string;
  website: string;
  size: string;
  interest: string;
  message: string;
  /** GDPR marketing consent. Must be `true`; the form gates the button on it too. */
  consent: boolean;
}

/** A submission that passed validation, trimmed and stamped. */
export interface SalesLead extends SalesLeadSubmission {
  consent: true;
  /** ISO-8601 instant the consent was given, recorded alongside the value. */
  consentAt: string;
}

export type SalesLeadErrors = Partial<Record<keyof SalesLeadSubmission, string>>;

export type SalesLeadValidation =
  | { ok: true; lead: SalesLead }
  | { ok: false; errors: SalesLeadErrors };

/**
 * Field ceilings. Generous for humans, small enough that a bot cannot post a
 * megabyte of link spam through the one unauthenticated write on the site.
 */
export const SALES_LEAD_LIMITS = {
  email: 254,
  name: 120,
  phone: 40,
  website: 200,
  message: 4000,
} as const;

/** Deliberately loose: one `@`, no whitespace, a dot in the domain. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Accepts `example.edu`, `https://example.edu/x`; rejects `javascript:` and friends. */
function normalizeWebsite(raw: string): string | null {
  if (!raw) return "";
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname.includes(".")) return null;
  return url.toString();
}

/**
 * Validates a submission of unknown shape. The browser's `required` attributes
 * are a convenience; this is the only check that actually holds.
 */
export function validateSalesLead(
  raw: Partial<SalesLeadSubmission> | Record<string, unknown>,
  now: Date = new Date()
): SalesLeadValidation {
  const input = raw as Record<string, unknown>;
  const errors: SalesLeadErrors = {};

  const email = text(input.email);
  if (!email) errors.email = "Enter your institution email.";
  else if (email.length > SALES_LEAD_LIMITS.email) errors.email = "That email is too long.";
  else if (!EMAIL_RE.test(email)) errors.email = "That doesn't look like an email address.";

  const name = text(input.name);
  if (!name) errors.name = "Enter your name.";
  else if (name.length > SALES_LEAD_LIMITS.name) errors.name = "That name is too long.";

  const phone = text(input.phone);
  if (phone.length > SALES_LEAD_LIMITS.phone) errors.phone = "That phone number is too long.";

  const country = text(input.country);
  if (!SALES_COUNTRIES.includes(country as (typeof SALES_COUNTRIES)[number])) {
    errors.country = "Choose a country from the list.";
  }

  const rawWebsite = text(input.website);
  let website = "";
  if (rawWebsite.length > SALES_LEAD_LIMITS.website) {
    errors.website = "That address is too long.";
  } else {
    const normalized = normalizeWebsite(rawWebsite);
    if (normalized === null) errors.website = "Enter a valid web address.";
    else website = normalized;
  }

  const size = text(input.size);
  if (size && !SALES_COMPANY_SIZES.includes(size as (typeof SALES_COMPANY_SIZES)[number])) {
    errors.size = "Choose a size from the list.";
  }

  const interest = text(input.interest);
  if (
    interest &&
    !SALES_PRODUCT_INTERESTS.includes(interest as (typeof SALES_PRODUCT_INTERESTS)[number])
  ) {
    errors.interest = "Choose an option from the list.";
  }

  const message = text(input.message);
  if (message.length > SALES_LEAD_LIMITS.message) {
    errors.message = "Please keep your message under 4000 characters.";
  }

  if (input.consent !== true) {
    errors.consent = "We need your consent before we can contact you.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    lead: {
      email,
      name,
      phone,
      country,
      website,
      size,
      interest,
      message,
      consent: true,
      consentAt: now.toISOString(),
    },
  };
}

/** Where the lead lands. Unset means the funnel is not wired — the action says so. */
export function salesInboxAddress(): string {
  return process.env.CONTACT_SALES_EMAIL?.trim() ?? "";
}

/**
 * The lead as an email. The consent value and its timestamp travel in the body
 * because this message *is* the record of consent — there is no lead table.
 * `replyTo` is the enquirer, so a reply from the alias reaches them directly.
 */
export function salesLeadEmail(
  lead: SalesLead,
  meta: { to: string; sourceUrl?: string }
): EmailMessage {
  const lines = [
    `Name:         ${lead.name}`,
    `Email:        ${lead.email}`,
    `Phone:        ${lead.phone || "—"}`,
    `Country:      ${lead.country}`,
    `Website:      ${lead.website || "—"}`,
    `Size:         ${lead.size || "—"}`,
    `Interest:     ${lead.interest || "—"}`,
    "",
    "How can we help?",
    lead.message || "—",
    "",
    `Marketing consent: granted at ${lead.consentAt}`,
    meta.sourceUrl ? `Submitted from: ${meta.sourceUrl}` : "Submitted from: /contact/sales",
  ];
  return {
    to: meta.to,
    subject: `Sales enquiry — ${lead.name} (${lead.email})`,
    body: lines.join("\n"),
    replyTo: lead.email,
  };
}
