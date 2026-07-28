import type { Metadata } from "next";
import { getSession } from "@/lib/auth";
import { getEnterpriseCapabilities } from "@agent-hub/agent";
import { HomeFooter } from "@/components/home/home-footer";
import { HomeShell } from "@/components/home/home-shell";
import { PricingContent } from "@/components/marketing/pricing-content";

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
 * enterprise capabilities at server start, but this page is prerendered at build
 * time — a phase that never runs instrumentation — so relying on it alone bakes
 * "no catalog" into the static HTML and the page publishes no prices however the
 * deployment is configured. Importing the registration entrypoint here puts it in
 * this route's own module graph, so the capabilities are registered before the
 * first read whichever phase performs it.
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
    title: "Pricing — Ciele",
    description: `Ciele pricing: self-hosted, Go, Business and Enterprise. Self-hosting is free under AGPL-3.0; every managed plan includes the whole product for unlimited members. ${managed}`,
  };
}

export default async function PricingPage() {
  const session = await getSession();

  // The plan ladder — prices and allowance-derived volumes — comes from the
  // enterprise billing seam, so the open-source edition renders this same page
  // with no prices to publish rather than a ladder nobody can buy.
  const catalog = await planCatalogForPage();

  // Read the env directly rather than importing ee/billing's isStripeConfigured:
  // this page ships in the open-source mirror, which has no `src/ee` at all, so
  // the import would not resolve there. Without a secret key there is no
  // checkout route to send anyone to, and the plan buttons fall back to sales.
  const billingEnabled = Boolean(process.env.STRIPE_SECRET_KEY);

  return (
    <HomeShell authenticated={session !== null}>
      <PricingContent billingEnabled={billingEnabled} catalog={catalog} />
      <HomeFooter />
    </HomeShell>
  );
}
