/**
 * Enterprise capability registry: the single edition-gating seam (#435).
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
 * editions, the mirror simply omits the enterprise code and its stub is a
 * no-op.
 */

import type {
  ActivationState,
  BillingAccountSnapshot,
  CheckoutReturn,
  PlanCatalog,
  SubscriptionState,
  UpgradeCheckoutInput,
  UsageCheckInput,
  UsageLimitsSnapshot,
  UsageOutcome,
} from "@agent-hub/core";

// The billing / plan / usage-cap VOCABULARY lives in @agent-hub/core
// (billing.ts), the domain package is its declared home, and it is pure
// types plus one shared constant. Re-exported here unchanged so every
// consumer that learned these names through the runtime barrel keeps
// compiling; new code should import them from @agent-hub/core. What stays in
// this module is the SEAM: the capability interfaces the registry gates on,
// their OSS defaults, and the registry itself.
export { USAGE_WARN_FRACTION } from "@agent-hub/core";
export type {
  ActivationState,
  AnswerModelBasis,
  BillingAccountSnapshot,
  BillingInvoice,
  BillingPaymentMethod,
  CheckoutReturn,
  PlanCatalog,
  PlanCatalogEntry,
  PlanVolumes,
  SubscriptionState,
  UpgradeCheckoutInput,
  UsageCheckInput,
  UsageLimitsSnapshot,
  UsageMeterSnapshot,
  UsageOutcome,
  UsageWindow,
  UsageWindowName,
} from "@agent-hub/core";

/** Plan-cap enforcement at the model-call boundary. OSS default: allow all. */
export interface MeteringEnforcement {
  checkUsage(input: UsageCheckInput): Promise<UsageOutcome>;
  /**
   * The caps and consumption an admin surface shows (#509), or null when the
   * organization is not capped at all, which is what a self-hosted deployment
   * always sees, and why the Usage page can render honestly with no enterprise
   * code present.
   */
  getUsageLimits(organizationId: string): Promise<UsageLimitsSnapshot | null>;
}

/** Managed-subscription lookup. OSS default: no subscription. */
export interface BillingAccessor {
  getSubscription(organizationId: string): Promise<SubscriptionState | null>;
  /**
   * The purchasable tiers with their prices and derived allowances, or null when
   * there is nothing to sell, which is what a self-hosted deployment always
   * sees, and why the public pricing page renders honestly with no enterprise
   * code present.
   */
  getPlanCatalog(): PlanCatalog | null;
  /**
   * Start hosted checkout for a NEW subscription and return its URL, or null
   * when this deployment cannot sell it (OSS, an unconfigured Stripe Price, a
   * sales-led tier, or an organization that already has a live subscription,
   * that is a Customer Portal change, not a second Checkout).
   *
   * Returns null rather than throwing for any of those *configuration* cases; a
   * Stripe or database failure still throws, so callers must handle both.
   */
  startUpgradeCheckout(input: UpgradeCheckoutInput): Promise<string | null>;
  /**
   * Open the Stripe Customer Portal: where an existing subscriber changes tier,
   * updates a card, or cancels. Null when there is no Stripe customer to open it
   * for (OSS, a comped grant, an unconfigured Stripe).
   */
  startBillingPortal(organizationId: string): Promise<string | null>;
  /**
   * Write the subscription for a checkout session the buyer has just returned
   * from, so activation does not wait on the webhook. `true` when a row was
   * written; `false` for every case that legitimately writes nothing, no
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
   * nothing to read (OSS, a comped grant, an unconfigured provider), the
   * Billing tab then shows only what our own row already says.
   *
   * Costs provider round-trips, so call it from a billing surface, never from a
   * request path that only needs the plan.
   */
  getBillingAccount(
    organizationId: string,
  ): Promise<BillingAccountSnapshot | null>;
}

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
 * compile those two into separate module instances, Next's dev server does
 * exactly that for `instrumentation.ts`, and a module-scoped variable then
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
 * The active enterprise capabilities: OSS no-op defaults unless the enterprise
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
