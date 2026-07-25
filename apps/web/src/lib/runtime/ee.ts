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

/** Outcome of a usage check. OSS always returns `allow`. */
export type UsageOutcome =
  | { outcome: "allow" }
  | { outcome: "warn"; usedFraction: number }
  | { outcome: "block"; message: string };

export interface UsageCheckInput {
  organizationId: string;
  /**
   * Platform-funded traffic is enforceable against a plan cap; bring-your-own-
   * key traffic is never blocked (a customer's own credentials are their own
   * cost). The enterprise enforcement implementation keys on this (#442).
   */
  connectionKind: "platform" | "byok";
}

/** Plan-cap enforcement at the model-call boundary. OSS default: allow all. */
export interface MeteringEnforcement {
  checkUsage(input: UsageCheckInput): Promise<UsageOutcome>;
}

export interface SubscriptionState {
  plan: string;
  status: string;
  /**
   * A hosted checkout URL staff attached so this organization can convert
   * (#444). Null whenever there is nothing to pay — always null in OSS.
   */
  checkoutUrl: string | null;
}

/** Managed-subscription lookup. OSS default: no subscription. */
export interface BillingAccessor {
  getSubscription(organizationId: string): Promise<SubscriptionState | null>;
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
  },
  billing: {
    // OSS has no managed subscription concept.
    async getSubscription() {
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

let current: EnterpriseCapabilities = OSS_DEFAULTS;

/**
 * Register enterprise implementations. Shallow-merges over the current
 * capabilities so a caller may override a subset; untouched capabilities keep
 * their OSS default. Called once at startup by the enterprise edition; never
 * called in OSS (its registration stub registers nothing).
 */
export function registerEnterpriseCapabilities(
  overrides: Partial<EnterpriseCapabilities>
): void {
  current = { ...current, ...overrides };
}

/**
 * The active enterprise capabilities — OSS no-op defaults unless the enterprise
 * edition registered overrides at startup. Read this wherever the editions
 * diverge (e.g. the turn pipeline's usage gate).
 */
export function getEnterpriseCapabilities(): EnterpriseCapabilities {
  return current;
}

/** Test-only: restore the OSS no-op defaults. Not exported through the barrel. */
export function resetEnterpriseCapabilities(): void {
  current = OSS_DEFAULTS;
}
