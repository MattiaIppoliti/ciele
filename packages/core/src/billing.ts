/**
 * The billing / plan / usage-cap vocabulary, pure domain types with no
 * behavior. Moved here from the runtime's enterprise capability registry
 * (`@agent-hub/agent`'s `ee.ts`, which re-exports them unchanged): this
 * package is the declared home for the domain, and these ~15 types are
 * vocabulary the admin surfaces, the pricing page and the enterprise
 * implementations all read. The extension-point interfaces the registry
 * gates on (`MeteringEnforcement`, `BillingAccessor`, `ActivationPolicy`)
 * stay in the runtime; they are the seam, not the vocabulary.
 */

import type { UsageResource } from "./types";

/**
 * The two windows a plan allowance is measured over (#507): the billing period
 * itself, and a seven-day slice of it. Both are anchored to what the
 * organization pays for, never to the calendar.
 */
export type UsageWindowName = "week" | "month";

/** One window as a half-open `[from, to)` range of ISO instants. */
export interface UsageWindow {
  name: UsageWindowName;
  from: string;
  /** Exclusive end, also the instant the window resets. */
  to: string;
}

/**
 * The share of a cap at which a meter starts warning, short of blocking.
 *
 * Declared on the open-source side even though enforcement is an enterprise
 * concern: the admin surface has to colour a gauge amber at exactly the
 * threshold the enterprise ladder warns at (open-source code may never import
 * from `src/ee/`). One constant, so the banner and the ring can never disagree
 * about where "nearly full" starts.
 */
export const USAGE_WARN_FRACTION = 0.8;

/**
 * Outcome of a usage check. OSS always returns `allow`.
 *
 * `warn` and `block` name the resource and window that tripped and when it
 * lifts, so a caller can tell an admin which limit to act on, and a visitor
 * only ever sees `message`, which discloses nothing about billing.
 */
export type UsageOutcome =
  | { outcome: "allow" }
  | {
      outcome: "warn";
      usedFraction: number;
      resource: UsageResource;
      window: UsageWindowName;
      /** When the tripped window resets, ISO. */
      resetsAt: string;
    }
  | {
      outcome: "block";
      message: string;
      resource: UsageResource;
      window: UsageWindowName;
      resetsAt: string;
    };

export interface UsageCheckInput {
  organizationId: string;
  /**
   * Platform-funded traffic is enforceable against a plan cap; bring-your-own-
   * key traffic is never blocked (a customer's own credentials are their own
   * cost). The enterprise enforcement implementation keys on this (#442).
   */
  connectionKind: "platform" | "byok";
  /**
   * Which metered resource this work consumes. The three are capped
   * independently so an exhausted crawl budget never stops answering (#506).
   */
  resource: UsageResource;
}

/** One meter as an admin surface reads it: the cap, what is used, the window. */
export interface UsageMeterSnapshot {
  resource: UsageResource;
  window: UsageWindow;
  /** Credits included in this window; null means uncapped on this resource. */
  cap: number | null;
  usedCredits: number;
}

/** Every meter for one organization, plus the plan they come from. */
export interface UsageLimitsSnapshot {
  plan: string;
  meters: UsageMeterSnapshot[];
}

export interface SubscriptionState {
  plan: string;
  status: string;
  /**
   * A hosted checkout URL staff attached so this organization can convert
   * (#444). Null whenever there is nothing to pay, always null in OSS.
   */
  checkoutUrl: string | null;
  /**
   * A live Stripe subscription backs this plan. When true, changing the plan or
   * cancelling belongs in the Customer Portal: hosted Checkout in subscription
   * mode always CREATES a subscription, so offering it here would bill the
   * organization twice and orphan the first subscription (#511). False for a
   * comped grant, and always false in OSS.
   */
  stripeManaged: boolean;
}

/**
 * One tier's monthly allowance restated as volumes of work (#511). Derived from
 * the same allowance constants the caps use, so a raised cap cannot leave a
 * stale number on the pricing page.
 */
export interface PlanVolumes {
  /** Approximate assistant answers, on the platform's default model. */
  answers: number;
  /** Approximate pages a crawl may fetch. */
  pages: number;
  /** Approximate documents that may be indexed. */
  documents: number;
}

/** One purchasable tier as the public pricing page and Billing read it. */
export interface PlanCatalogEntry {
  /**
   * The code's own tier slug, printed verbatim in public copy and used as the
   * Stripe product name: so an invoice, a support conversation and the console
   * all say the same word.
   */
  slug: string;
  /** Published monthly price, EUR net. A floor for a sales-led tier. */
  priceEur: number;
  /** Sized in a conversation: the price reads "from €X" and the CTA is contact. */
  salesLed: boolean;
  /** Hosted checkout can actually be started for this tier right now. */
  checkout: boolean;
  volumes: PlanVolumes;
}

/**
 * Which model an answer volume is quoted on, and how much dearer per answer the
 * mid-tier frontier model is. Published next to the volumes: an answer count
 * means nothing without the model it was priced on.
 */
export interface AnswerModelBasis {
  quotedModel: string;
  frontierModel: string;
  /** How many times more one answer costs on the frontier model. */
  frontierFactor: number;
}

/** The purchasable ladder, plus what its answer volumes are quoted on. */
export interface PlanCatalog {
  tiers: PlanCatalogEntry[];
  answerBasis: AnswerModelBasis;
}

/** A card (or other method) as a billing page names it, never card data. */
export interface BillingPaymentMethod {
  /** "visa", "amex", "sepa_debit"… straight from the provider. */
  brand: string;
  last4: string;
  expMonth: number | null;
  expYear: number | null;
}

/** One issued invoice, as the billing page lists it. */
export interface BillingInvoice {
  id: string;
  /**
   * The provider's human invoice number (e.g. "N3WRKR5S-0001"), or null before
   * one is assigned. This is the reference an accounts department reconciles
   * against, so it is worth a column of its own, `id` is ours to key rows with.
   */
  number: string | null;
  /** ISO instant the invoice was issued. */
  issuedAt: string;
  /** Minor-unit total in `currency` (a provider always bills in minor units). */
  amountMinor: number;
  currency: string;
  /** "paid", "open", "void"… the provider's own word, printed as a badge. */
  status: string;
  /** Provider-hosted invoice page, when it published one. */
  url: string | null;
}

/**
 * The provider-side billing account behind a subscription (#settings-modal):
 * what renews when, on which card, and the invoices already issued.
 *
 * Distinct from `SubscriptionState`, which is our own stored row and is read on
 * every request: this one costs live provider calls, so it is fetched only by
 * the Billing tab. Null whenever there is no provider account to read, OSS,
 * a comped grant, an unconfigured provider.
 */
export interface BillingAccountSnapshot {
  /** ISO instant the current period ends, the next invoice's date. */
  renewsAt: string | null;
  /** Expected total of the next invoice, in minor units of `currency`. */
  nextAmountMinor: number | null;
  currency: string;
  /** Set when the subscription is scheduled to stop, ISO. */
  cancelAt: string | null;
  paymentMethod: BillingPaymentMethod | null;
  /** Most recent first. */
  invoices: BillingInvoice[];
}

/** What an organization needs to start hosted checkout for a tier. */
export interface UpgradeCheckoutInput {
  organizationId: string;
  /** A tier slug from the catalog. */
  plan: string;
  /** Prefill for an organization with no Stripe customer yet. */
  customerEmail?: string | null;
}

/** The checkout session a buyer was redirected back with. */
export interface CheckoutReturn {
  organizationId: string;
  /** The provider's session id, straight from the return URL. Untrusted. */
  sessionId: string;
}

/**
 * Whether an Organization may run assistant traffic (#444).
 *
 * `pending` is a managed-edition state only: on ciele's hosted platform a
 * fresh signup waits for sales contact before its assistants answer, because
 * the managed promise includes ciele-funded model credentials. **A
 * self-hosted deployment must never see it**; there is nobody to activate an
 * org there, and a locked-out self-host would be a broken product. That is why
 * the runtime's OSS default is unconditionally `active`.
 */
export type ActivationState =
  | { state: "active" }
  | {
      /** No assistant traffic, and no platform-funded credentials. */
      state: "pending";
      /** Shown to a visitor in the widget when a turn is refused. */
      visitorMessage: string;
    };
