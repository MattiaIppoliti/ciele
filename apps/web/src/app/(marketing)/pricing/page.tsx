import type { Metadata } from "next";
import { getEnterpriseCapabilities } from "@agent-hub/agent";
import { PricingContent } from "@/components/marketing/pricing-content";

/**
 * Regenerate on the running server rather than serving the build's answer for
 * the life of the deployment.
 *
 * Alone among the marketing pages, what this one publishes depends on *server
 * configuration*: `STRIPE_SECRET_KEY` below and the `STRIPE_PRICE_*` ids
 * `priceIdForPlan` reads through the catalog. A prerender freezes both at build
 * time, and the self-host image is built before that configuration exists —
 * `deploy/docker-compose.yml` passes only `NEXT_PUBLIC_*` as build args and
 * supplies everything else as runtime environment. So a fully static page would
 * publish "no prices, talk to sales" permanently on a stack whose Stripe keys
 * arrive at boot, and no amount of restarting would change it.
 *
 * `revalidate` keeps the page prerendered — the point of the whole group — while
 * making the build's HTML the *first* answer rather than the only one: the next
 * request after the window regenerates on the server that has the environment,
 * and every request after that is served the real ladder from the cache. Both
 * readers below re-run, so the price in the metadata description tracks the body.
 *
 * Bounded staleness is the trade, and five minutes is sized to the thing that
 * actually changes: an operator configuring Stripe, not a per-request fact.
 * Prices themselves are a code change, which redeploys anyway.
 */
export const revalidate = 300;

/**
 * The description carries a price, so it reads the catalog through the same seam
 * the body does. A hardcoded number here would be a second place a price is
 * stated — and on the open-source edition it would advertise plans the page does
 * not show.
 */
/**
 * Reads the plan catalog through the enterprise capability seam.
 *
 * The import is what makes the read reliable. `instrumentation.ts` registers the
 * enterprise capabilities at server start, which covers a request-time render
 * but not the build, and this page is read in both phases (see `revalidate`
 * above) by two readers — the body and `generateMetadata`. Neither can assume
 * registration-at-start happened, and a phase that skipped it would report "no
 * prices" however the deployment is configured. Importing the registration
 * entrypoint here puts it in this route's own module graph, so the capabilities
 * are registered before the first read whichever phase performs it.
 *
 * Mirror-safe: the public tree overlays an inert stub at this exact path, so the
 * import resolves in both editions and registers nothing in the open-source one.
 */
async function planCatalogForPage() {
  await import("@/ee/register");
  return getEnterpriseCapabilities().billing.getPlanCatalog();
}

export async function generateMetadata(): Promise<Metadata> {
  const catalog = await planCatalogForPage();
  const entry = catalog?.tiers.reduce(
    (cheapest, tier) =>
      cheapest && cheapest.priceEur <= tier.priceEur ? cheapest : tier,
    null as { priceEur: number } | null
  );
  const managed = entry
    ? `Cloud plans from €${entry.priceEur.toLocaleString("en-US")} a month.`
    : "Ciele Cloud plans start with a conversation.";
  return {
    title: "Pricing | Ciele",
    description: `Ciele pricing: self-hosted, Go, Business and Enterprise. Self-hosting is free under AGPL-3.0; every managed plan includes the whole product for unlimited members. ${managed}`,
  };
}

export default async function PricingPage() {
  // The plan ladder — prices and allowance-derived volumes — comes from the
  // enterprise billing seam, so the open-source edition renders this same page
  // with no prices to publish rather than a ladder nobody can buy.
  const catalog = await planCatalogForPage();

  // Read the env directly rather than importing ee/billing's isStripeConfigured:
  // this page ships in the open-source mirror, which has no `src/ee` at all, so
  // the import would not resolve there. Without a secret key there is no
  // checkout route to send anyone to, and the plan buttons fall back to sales.
  const billingEnabled = Boolean(process.env.STRIPE_SECRET_KEY);

  return <PricingContent billingEnabled={billingEnabled} catalog={catalog} />;
}
