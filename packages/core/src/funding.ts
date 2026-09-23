/**
 * Funding attribution: who paid for a model call.
 *
 * A derivation over `AiCredentialKind`, kept in its own module because
 * `types.ts` holds declarations only. It lives here rather than in a consumer
 * because three surfaces need the same answer, the runtime's plan-cap gate, the
 * staff console's usage reporting, and billing, and the admin console used to
 * restate it as a hand-maintained `Set<string>`.
 */

import type { AiCredentialKind } from "./types";

/** Who pays for the tokens. The split staff read in usage reporting. */
export type FundingBucket = "platform" | "customer" | "unknown";

/**
 * Funding attribution per credential kind, **exhaustive by construction**.
 *
 * `satisfies Record<AiCredentialKind, …>` is the point: adding a kind to the
 * union above without classifying it here is a compile error. Funding is the
 * direction plan caps and billing act on, so a new kind must be attributed
 * deliberately, and the old shape (a `Set<string>` of "customer" kinds, restated
 * by hand in the admin console) let a new kind silently under-report as
 * "unknown" instead.
 */
const FUNDING_BY_CREDENTIAL_KIND = {
  platform: "platform",
  api_key: "customer",
  google_vertex_federated: "customer",
  local_subscription: "customer",
} satisfies Record<AiCredentialKind, Exclude<FundingBucket, "unknown">>;

/**
 * Who funded a call, from its recorded credential kind.
 *
 * Takes a `string` on purpose: the value arrives from the usage ledger, so a row
 * written by a newer deployment can carry a kind this build has never heard of.
 * That case maps to `"unknown"`, never to `"customer"`, so unattributed
 * traffic can never be silently billed to a customer. Within a single build the
 * map above makes every *known* kind a compile-time decision.
 */
export function fundingBucket(credentialKind: string): FundingBucket {
  // `Object.hasOwn`, not a bare index: the argument is an arbitrary string from
  // the ledger, and a raw lookup would inherit Object.prototype, making
  // `fundingBucket("constructor")` return a function rather than "unknown".
  return Object.hasOwn(FUNDING_BY_CREDENTIAL_KIND, credentialKind)
    ? FUNDING_BY_CREDENTIAL_KIND[credentialKind as AiCredentialKind]
    : "unknown";
}

/**
 * The credential kind a crawl records, from whose account it ran on.
 *
 * An Organization's own crawler token (Settings → Crawling) is the crawl
 * equivalent of a BYOK model key, so it records as `api_key` and funds as
 * "customer"; everything else ran on the platform's account.
 */
export function crawlCredentialKind(
  credential: "organization" | "platform" | undefined
): "api_key" | "platform" {
  return credential === "organization" ? "api_key" : "platform";
}

/**
 * The credential kind a usage reader attributes a recorded crawl to. Only
 * `api_key` moves a crawl off the platform. A crawl event written before
 * crawls carried a kind (null) ran on the platform's account, and anything
 * else is read the same way, so an unrecognised value can never take a crawl
 * out of the plan allowance. The SQL readers in
 * 20260922210000_crawl_usage_funding.sql apply the same rule.
 */
export function crawlMeterCredentialKind(
  recorded: string | null | undefined
): "api_key" | "platform" {
  return recorded === "api_key" ? "api_key" : "platform";
}
