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
export async function generateMetadata(): Promise<Metadata> {
  const catalog = getEnterpriseCapabilities().billing.getPlanCatalog();
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
    description: `Run Ciele yourself for free under AGPL-3.0, or let us run it for you with model credentials included. ${managed}`,
  };
}

export default async function PricingPage() {
  const session = await getSession();
  // The plan ladder comes from the enterprise capability seam, so the
  // open-source edition renders the self-host story with no prices to publish.
  const catalog = getEnterpriseCapabilities().billing.getPlanCatalog();

  return (
    <HomeShell authenticated={session !== null}>
      <PricingContent catalog={catalog} />
      <HomeFooter />
    </HomeShell>
  );
}
