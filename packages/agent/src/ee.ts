/**
 * Enterprise capability registry — the single edition-gating seam (#435).
 *
 * The open-source and enterprise editions are the SAME codebase; they differ
 * only by which implementations back the extension points declared here. OSS
 * ships inert no-op defaults (metering allows every call; billing reports no
 * subscription), so the public-mirror tree is a complete, working free product
 * with no enterprise code present. The enterprise edition registers real
 * implementations once at startup (see apps/web/src/ee/register.ts, a file
 * whose OSS version is an inert stub excluded from the public mirror).
 *
 * This is deliberately a process-level registry, not the per-turn tool
 * registry in `tools.ts`: capabilities are wired once at boot, then read via
 * `getEnterpriseCapabilities()` wherever the two editions diverge. Its public
 * surface is exported through the runtime barrel and locked by
 * `interface.test.ts` (ADR-0005), so widening the open-core boundary is a
 * reviewed act, not an accident. No build-time aliasing or config flag gates
 * editions — the mirror simply omits the enterprise code and its stub is a
 * no-op.
 */

import type { UsageResource } from "@agent-hub/core";

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
  /** Exclusive end — also the instant the window resets. */
  to: string;
}

/**
 * The share of a cap at which a meter starts warning, short of blocking.
 *
 * Declared here, on the open-source side, even though enforcement is an
 * enterprise concern: the admin surface has to colour a gauge amber at exactly
 * the threshold the enterprise ladder warns at, and this is the only module both
 * can reach (open-source code may never import from `src/ee/`). One constant, so
 * the banner and the ring can never disagree about where "nearly full" starts.
 */
export const USAGE_WARN_FRACTION = 0.8;

/**
 * Outcome of a usage check. OSS always returns `allow`.
 *
 * `warn` and `block` name the resource and window that tripped and when it
 * lifts, so a caller can tell an admin which limit to act on — and a visitor
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

/** Plan-cap enforcement at the model-call boundary. OSS default: allow all. */
export interface MeteringEnforcement {
  checkUsage(input: UsageCheckInput): Promise<UsageOutcome>;
  /**
   * The caps and consumption an admin surface shows (#509), or null when the
   * organization is not capped at all — which is what a self-hosted deployment
   * always sees, and why the Usage page can render honestly with no enterprise
   * code present.
   */
  getUsageLimits(organizationId: string): Promise<UsageLimitsSnapshot | null>;
}

export interface SubscriptionState {
  plan: string;
  status: string;
  /**
   * A hosted checkout URL staff attached so this organization can convert
   * (#444). Null whenever there is nothing to pay — always null in OSS.
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
   * Stripe product name — so an invoice, a support conversation and the console
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

/** A card (or other method) as a billing page names it — never card data. */
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
 * the Billing tab. Null whenever there is no provider account to read — OSS,
 * a comped grant, an unconfigured provider.
 */
export interface BillingAccountSnapshot {
  /** ISO instant the current period ends — the next invoice's date. */
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

/** Managed-subscription lookup. OSS default: no subscription. */
export interface BillingAccessor {
  getSubscription(organizationId: string): Promise<SubscriptionState | null>;
  /**
   * The purchasable tiers with their prices and derived allowances, or null when
   * there is nothing to sell — which is what a self-hosted deployment always
   * sees, and why the public pricing page renders honestly with no enterprise
   * code present.
   */
  getPlanCatalog(): PlanCatalog | null;
  /**
   * Start hosted checkout for a NEW subscription and return its URL, or null
   * when this deployment cannot sell it (OSS, an unconfigured Stripe Price, a
   * sales-led tier, or an organization that already has a live subscription —
   * that is a Customer Portal change, not a second Checkout).
   *
   * Returns null rather than throwing for any of those *configuration* cases; a
   * Stripe or database failure still throws, so callers must handle both.
   */
  startUpgradeCheckout(input: UpgradeCheckoutInput): Promise<string | null>;
  /**
   * Open the Stripe Customer Portal — where an existing subscriber changes tier,
   * updates a card, or cancels. Null when there is no Stripe customer to open it
   * for (OSS, a comped grant, an unconfigured Stripe).
   */
  startBillingPortal(organizationId: string): Promise<string | null>;
  /**
   * Write the subscription for a checkout session the buyer has just returned
   * from, so activation does not wait on the webhook. `true` when a row was
   * written; `false` for every case that legitimately writes nothing — no
   * checkout provider, a session that does not belong to this organization, one
   * that has not paid, or a subscription already recorded.
   *
   * Intended for the redirect back from checkout, where the session id is
   * attacker-supplied: implementations must verify the session belongs to
   * `organizationId` rather than trusting it.
   */
  reconcileCheckout(input: CheckoutReturn): Promise<boolean>;
  /**
   * The live provider-side account: renewal, card, invoices. Null when there is
   * nothing to read (OSS, a comped grant, an unconfigured provider) — the
   * Billing tab then shows only what our own row already says.
   *
   * Costs provider round-trips, so call it from a billing surface, never from a
   * request path that only needs the plan.
   */
  getBillingAccount(
    organizationId: string,
  ): Promise<BillingAccountSnapshot | null>;
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
 * self-hosted deployment must never see it** — there is nobody to activate an
 * org there, and a locked-out self-host would be a broken product. That is why
 * the OSS default below is unconditionally `active`.
 */
export type ActivationState =
  | { state: "active" }
  | {
      /** No assistant traffic, and no platform-funded credentials. */
      state: "pending";
      /** Shown to a visitor in the widget when a turn is refused. */
      visitorMessage: string;
    };

/** Organization activation. OSS default: every organization is active. */
export interface ActivationPolicy {
  getActivation(organizationId: string): Promise<ActivationState>;
}

/** The full set of enterprise extension points. */
export interface EnterpriseCapabilities {
  metering: MeteringEnforcement;
  billing: BillingAccessor;
  activation: ActivationPolicy;
}

const OSS_DEFAULTS: EnterpriseCapabilities = {
  metering: {
    // OSS (and all BYOK traffic, in any edition) is never metered or blocked.
    // The enterprise edition overrides this to enforce plan caps on
    // platform-funded traffic only (#442).
    async checkUsage() {
      return { outcome: "allow" };
    },
    // Nothing to show: an open-source deployment has no plan to be capped by.
    async getUsageLimits() {
      return null;
    },
  },
  billing: {
    // OSS has no managed subscription concept.
    async getSubscription() {
      return null;
    },
    // Nothing to sell: the open-source edition is the free, uncapped path, so
    // the pricing page shows only that and Billing offers no upgrade.
    getPlanCatalog() {
      return null;
    },
    async startUpgradeCheckout() {
      return null;
    },
    async startBillingPortal() {
      return null;
    },
    // Nothing sells anything here, so there is no checkout return to reconcile.
    async reconcileCheckout() {
      return false;
    },
    // No payment provider, so no card, renewal or invoice history to read.
    async getBillingAccount() {
      return null;
    },
  },
  activation: {
    // A self-hosted organization is active the moment it exists. Only the
    // managed edition has an activation gate to fail (#444).
    async getActivation() {
      return { state: "active" };
    },
  },
};

/**
 * The registry cell, held on `globalThis` rather than in a module-level `let`.
 *
 * Why: registration happens once at startup from the host's instrumentation
 * entrypoint, and reads happen inside request handlers. A bundler is free to
 * compile those two into separate module instances — Next's dev server does
 * exactly that for `instrumentation.ts` — and a module-scoped variable then
 * gives the writer and the reader *different* cells: the enterprise edition
 * registers, and every request still sees the OSS defaults. A production build
 * shares one graph, so the bug appears only in development, which is the worst
 * place for it: the managed edition silently reads as open-source locally.
 *
 * The process is the intended scope of this registry (see the header), so
 * `globalThis` is the honest home for it rather than a workaround.
 */
const CELL = Symbol.for("@agent-hub/agent.enterpriseCapabilities");

interface RegistryHost {
  [CELL]?: { current: EnterpriseCapabilities };
}

function cell(): { current: EnterpriseCapabilities } {
  const host = globalThis as RegistryHost;
  return (host[CELL] ??= { current: OSS_DEFAULTS });
}

/**
 * Register enterprise implementations. Shallow-merges over the current
 * capabilities so a caller may override a subset; untouched capabilities keep
 * their OSS default. Called once at startup by the enterprise edition; never
 * called in OSS (its registration stub registers nothing).
 */
export function registerEnterpriseCapabilities(
  overrides: Partial<EnterpriseCapabilities>
): void {
  const held = cell();
  held.current = { ...held.current, ...overrides };
}

/**
 * The active enterprise capabilities — OSS no-op defaults unless the enterprise
 * edition registered overrides at startup. Read this wherever the editions
 * diverge (e.g. the turn pipeline's usage gate).
 */
export function getEnterpriseCapabilities(): EnterpriseCapabilities {
  return cell().current;
}

/** Test-only: restore the OSS no-op defaults. Not exported through the barrel. */
export function resetEnterpriseCapabilities(): void {
  cell().current = OSS_DEFAULTS;
}
