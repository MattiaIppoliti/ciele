import type { PlanCatalogEntry } from "@agent-hub/agent";

/**
 * How a plan catalog reads on Billing (#511).
 *
 * Pure, and on the open-source side of the boundary: the catalog itself is an
 * enterprise concern (prices and allowances live in `src/ee/billing`), but the
 * *copy* that presents it is the product's, and this is the layer every
 * console surface shares so a price can never read two ways. The public
 * pricing page no longer reads the catalog at all — it publishes exactly two
 * offerings, self-hosted and Enterprise, neither with a price — so the
 * consumers left are the in-console ones: Billing and the pending-activation
 * banner. A deployment with nothing to sell passes `null` and every function
 * here returns empty.
 *
 * The volume strings are formatted, never computed: the numbers arrive already
 * derived from the same allowance constants the caps enforce.
 */

/** The audience each tier is for, keyed by the tier's own slug. */
const AUDIENCE: Record<string, string> = {
  enterprise: "Organization-wide rollouts with procurement and security review.",
};

export interface PlanTierView {
  /** The tier slug — what Stripe, support and the console all call it. */
  slug: string;
  /** The slug, capitalized. Not a separate marketing name, deliberately. */
  name: string;
  /** "from", for a tier whose published price is a floor. Null otherwise. */
  pricePrefix: string | null;
  /** "€49". The period is stated once by the page, not per tier. */
  priceLabel: string;
  audience: string;
  /** One line per metered resource, in the order the meters are listed. */
  volumes: string[];
  /**
   * Sized in a conversation rather than bought. Distinct from `cta` on purpose:
   * this is a property of the TIER, so the public page can send a self-serve
   * visitor to sign-up whether or not Stripe happens to be configured yet.
   */
  salesLed: boolean;
  /**
   * Whether checkout can be started for this tier RIGHT NOW — what an in-product
   * upgrade button branches on, since a button that cannot reach Stripe is worse
   * than the conversation it replaces.
   */
  cta: "checkout" | "contact";
  priceEur: number;
}

const formatCount = (value: number): string => value.toLocaleString("en-US");

/**
 * How a tier slug is written in a sentence. The slug itself, capitalized —
 * never a separate marketing name, so the console, an invoice and a support
 * conversation all say the same word. Exported because a surface showing a plan
 * the catalog does not know still has to write it the same way.
 */
export const planDisplayName = (slug: string): string =>
  slug.charAt(0).toUpperCase() + slug.slice(1);

const titleCase = planDisplayName;

/**
 * The tiers, cheapest first. Sorted here rather than trusted from the catalog:
 * the ladder's order is what a reader uses to compare, so it must not depend on
 * how the enterprise side happened to enumerate its tiers.
 */
export function planTierViews(
  catalog: readonly PlanCatalogEntry[] | null
): PlanTierView[] {
  if (!catalog) return [];
  return [...catalog]
    .sort((a, b) => a.priceEur - b.priceEur)
    .map((entry) => ({
      slug: entry.slug,
      name: titleCase(entry.slug),
      pricePrefix: entry.salesLed ? "from" : null,
      priceLabel: `€${formatCount(entry.priceEur)}`,
      // An unrecognized slug gets no audience line rather than a guessed one.
      audience: AUDIENCE[entry.slug] ?? "",
      volumes: [
        // "About", because the answer count depends on which model the
        // assistants run — the page says so next to these lines.
        `About ${formatCount(entry.volumes.answers)} assistant answers a month`,
        `${formatCount(entry.volumes.pages)} pages crawled a month`,
        `${formatCount(entry.volumes.documents)} documents indexed a month`,
      ],
      salesLed: entry.salesLed,
      cta: entry.checkout ? "checkout" : "contact",
      priceEur: entry.priceEur,
    }));
}

/**
 * The tiers a customer can buy right here, right now — self-serve and with a
 * Stripe Price that checkout can actually reach.
 *
 * This is what decides whether a pending organization is offered a card field or
 * a conversation. Both are legitimate answers: with no sellable tier (the open
 * source edition, or a managed deployment whose Prices are not configured yet)
 * the only honest CTA is sales, and a "pay now" button that lands on
 * /contact/sales is worse than no button.
 */
export function selfServeTiers(
  catalog: readonly PlanCatalogEntry[] | null
): PlanTierView[] {
  return planTierViews(catalog).filter(
    (tier) => !tier.salesLed && tier.cta === "checkout"
  );
}

/** The catalog entry an organization is currently on, if the catalog knows it. */
export function currentPlanEntry(
  plan: string | null | undefined,
  catalog: readonly PlanCatalogEntry[] | null
): PlanCatalogEntry | null {
  if (!catalog || !plan) return null;
  return catalog.find((entry) => entry.slug === plan) ?? null;
}

/**
 * The tiers an organization can move to, cheapest first.
 *
 * `paying` is what decides whether the current tier is included. An organization
 * on a comped evaluation of Go is not paying for Go, so Go is the single most
 * likely thing it wants to buy — excluding it would hide the conversion. An
 * organization already paying for Go has nothing to gain from buying Go again.
 *
 * A plan the catalog does not recognize (a retired slug, a hand-edited row) is
 * treated as below everything, so the whole ladder is offered. That is the safe
 * direction: showing a tier the organization may already have is a small
 * annoyance, hiding the one they want to buy is a lost upgrade.
 */
export function upgradeOptions(
  plan: string | null | undefined,
  catalog: readonly PlanCatalogEntry[] | null,
  options: { paying?: boolean } = {}
): PlanTierView[] {
  const views = planTierViews(catalog);
  const current = currentPlanEntry(plan, catalog);
  if (!current) return views;
  return views.filter((tier) =>
    options.paying
      ? tier.priceEur > current.priceEur
      : tier.priceEur >= current.priceEur
  );
}
