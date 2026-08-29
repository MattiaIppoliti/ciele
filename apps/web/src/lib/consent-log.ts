import { z } from "zod";
import { createDb, getMockDb, isSupabaseConfigured, type Db } from "@agent-hub/db";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { CONSENT_CATEGORIES } from "@/lib/cookie-consent";

/**
 * Server-side record of cookie-consent decisions.
 *
 * GDPR Art. 7(1) puts the burden on us to demonstrate that consent was given.
 * The `cc_cookie` on the visitor's device is evidence *they* hold and can erase
 * at any moment, so on its own it discharges nothing. This module is our copy:
 * what was chosen, against which revision of the declaration, and when.
 *
 * The endpoint is public and unauthenticated, anonymous visitors are exactly
 * who we need records for, which makes the parsing below a trust boundary, not
 * a formality. Everything here is hostile input except the two facts we take
 * from the request itself (the user agent header and our own clock).
 */

const KNOWN_CATEGORY_IDS = CONSENT_CATEGORIES.map((category) => category.id);

/** Caps that bound what a single anonymous request can persist. */
export const CONSENT_LOG_LIMITS = {
  consentId: 128,
  pageUrl: 500,
  userAgent: 400,
  categories: 32,
  /** Refuse absurd bodies outright rather than parsing them. */
  bodyBytes: 4_000,
} as const;

/* Categories are checked against the live declaration rather than a hardcoded
   list, so adding one to CONSENT_CATEGORIES cannot leave the endpoint silently
   rejecting it. Unknown values are dropped, not fatal: a stale tab running an
   older bundle should still get its decision recorded. */
const categorySchema = z
  .array(z.string().max(64))
  .max(CONSENT_LOG_LIMITS.categories)
  .transform((values) => values.filter((value) => isKnownCategory(value)));

export function isKnownCategory(value: string): boolean {
  return (KNOWN_CATEGORY_IDS as string[]).includes(value);
}

export const consentRecordPayloadSchema = z.object({
  consentId: z.string().min(1).max(CONSENT_LOG_LIMITS.consentId),
  revision: z.number().int().min(0).max(100_000),
  acceptedCategories: categorySchema,
  rejectedCategories: categorySchema,
  /** The plugin's own vocabulary for the shape of the choice. */
  acceptType: z.enum(["all", "custom", "necessary"]),
  /** A first decision vs. a later edit or withdrawal. */
  action: z.enum(["granted", "changed"]),
  /** The visitor's clock. Kept, but never trusted over ours. */
  consentedAt: z.iso.datetime().nullish(),
  pageUrl: z.string().max(CONSENT_LOG_LIMITS.pageUrl).nullish(),
});

export type ConsentRecordPayload = z.infer<typeof consentRecordPayloadSchema>;

/**
 * Reduces a submitted page URL to origin + path.
 *
 * Query strings and fragments are dropped rather than stored: they routinely
 * carry tokens, email addresses and search terms, none of which this record
 * needs. Keeping only "which page" is the minimum that makes a record useful
 * (Art. 5(1)(c)). Anything that is not an http(s) URL becomes "".
 */
export function sanitizePageUrl(raw: string | null | undefined): string {
  if (!raw) return "";
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return "";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
  return `${parsed.origin}${parsed.pathname}`.slice(0, CONSENT_LOG_LIMITS.pageUrl);
}

/** Trims the header to something storable; absent or absurd becomes "". */
export function sanitizeUserAgent(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.slice(0, CONSENT_LOG_LIMITS.userAgent);
}

export interface ParsedConsentRecord {
  consentId: string;
  revision: number;
  acceptedCategories: string[];
  rejectedCategories: string[];
  acceptType: string;
  action: string;
  consentedAt: string | null;
  pageUrl: string;
  userAgent: string;
}

/**
 * Validates and normalises one submitted decision. Pure, so the trust boundary
 * is testable without a request, see consent-log.test.ts.
 *
 * Returns null on anything malformed. Callers answer 204 either way: a visitor
 * gets no signal about whether our audit log accepted their payload, and a
 * probe learns nothing from the response.
 */
export function parseConsentRecord(
  body: unknown,
  headers: { userAgent?: string | null }
): ParsedConsentRecord | null {
  const result = consentRecordPayloadSchema.safeParse(body);
  if (!result.success) return null;
  const payload = result.data;
  return {
    consentId: payload.consentId,
    revision: payload.revision,
    acceptedCategories: payload.acceptedCategories,
    rejectedCategories: payload.rejectedCategories,
    acceptType: payload.acceptType,
    action: payload.action,
    consentedAt: payload.consentedAt ?? null,
    pageUrl: sanitizePageUrl(payload.pageUrl),
    userAgent: sanitizeUserAgent(headers.userAgent),
  };
}

let serviceDb: Db | null = null;

/**
 * Service-role Db for the consent log. The table has RLS enabled and no
 * policies, so `anon` can neither read nor write it, an audit log a visitor
 * could rewrite would be worthless, and one they could read would leak other
 * visitors' records. Writes therefore have to come through the service role.
 *
 * Falls back to the in-memory demo store when Supabase is absent, so the
 * zero-config demo build keeps working instead of 500-ing on every consent.
 */
function getConsentDb(): Db {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return getMockDb();
  }
  serviceDb ??= createDb(createSupabaseServiceClient());
  return serviceDb;
}

/** Appends one decision. Never updates: a withdrawal is a new row. */
export async function recordConsent(record: ParsedConsentRecord): Promise<void> {
  await getConsentDb().table("cookieConsentRecords").insert(record);
}
