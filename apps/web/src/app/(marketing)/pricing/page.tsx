import type { Metadata } from "next";
import { getSession } from "@/lib/auth";
import { HomeFooter } from "@/components/home/home-footer";
import { HomeShell } from "@/components/home/home-shell";
import { PricingContent } from "@/components/marketing/pricing-content";

export const metadata: Metadata = {
  title: "Pricing — Ciele",
  description:
    "Run Ciele yourself for free under AGPL-3.0, or let us run it for you with model credentials included. Plans start with a conversation.",
};

export default async function PricingPage() {
  const session = await getSession();

  return (
    <HomeShell authenticated={session !== null}>
      <PricingContent />
      <HomeFooter />
    </HomeShell>
  );
}
