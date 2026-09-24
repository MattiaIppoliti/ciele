import { marketingMetadata } from "@/lib/marketing/seo";
import { PricingContent } from "@/components/marketing/pricing-content";

/**
 * The public pricing page.
 *
 * Fully static, like the rest of the marketing group: Ciele is offered exactly
 * two ways, self-hosted (free, open source) and Enterprise (managed,
 * sales-led), and neither publishes a price, so nothing here depends on server
 * configuration. No plan catalog is read and no Stripe key is consulted; the
 * Enterprise CTA is the conversation, on every deployment.
 */
export const metadata = marketingMetadata({
  title: "Pricing | Ciele",
  description: "Ciele pricing: self-hosted and Enterprise. Self-hosting is free under AGPL-3.0 and includes the whole product; Enterprise is a managed rollout on your own terms, sized with sales.",
  path: "/pricing",
});

export default function PricingPage() {
  return <PricingContent />;
}
