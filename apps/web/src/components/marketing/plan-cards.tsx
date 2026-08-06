import React from "react";
import { TiltCard } from "@/components/motion/tilt-card";

/**
 * The plan ladder as copy, plus the two bits of card presentation both halves of
 * the pricing page need: the tilt shell and the CTA look.
 *
 * Its own module because that page is split across the server/client seam: the
 * ladder is read by the comparison matrix (server-rendered) and by the plan
 * cards (a client island, since the recommended card follows the answers
 * picker). No `"use client"` directive — everything here renders from either
 * side.
 *
 * The card *bodies* are still written twice — the self-hosted card in
 * `pricing-content.tsx`, the tier cards in `plan-picker.tsx` — as they were
 * before the split, and the height floors (`min-h-17`, `min-h-8`, `min-h-38`)
 * that line their feature lists up are now a cross-file agreement. Worth
 * collapsing into one card component; it is a layout change, not a move, so it
 * is not this one.
 */

/**
 * What this page says about each tier that is NOT a number: who it is for, what
 * it unlocks, and how you buy it.
 *
 * Every price and every included volume is deliberately absent here. Those
 * arrive as a `PlanCatalog` from the enterprise billing seam — one ladder,
 * derived from the allowance constants the caps actually enforce and priced at
 * `PLAN_PRICE_EUR`, which is also what the Stripe products charge. Restating a
 * price in this file is how a marketing page and an invoice start disagreeing,
 * so the only pricing this module owns is the layout it renders it in.
 *
 * A deployment with no catalog (the open-source edition, which ships no
 * `src/ee`) therefore has no prices to publish, and the cards say so instead of
 * advertising a ladder that cannot be bought.
 *
 * Feature lines describe what the platform does today (see docs/ARCHITECTURE.md
 * §12 for the shipped-vs-inert breakdown). Enterprise's last two lines are
 * contractual rather than product: commitments sales makes, not switches.
 */
export interface Tier {
  /** Matches the catalog entry's slug — and the Stripe product's name. */
  slug: "go" | "business" | "enterprise";
  name: string;
  tagline: string;
  featuresLabel: string;
  features: string[];
  /**
   * The plan this tier buys through Stripe Checkout, or null for the sales-led
   * tier. Only these two have a Stripe Price env (`plans.ts` ENV_KEY), and the
   * checkout route rejects anything else.
   */
  checkoutPlan: "go" | "business" | null;
  salesCta: string;
  recommended: boolean;
}

export const TIERS: Tier[] = [
  {
    slug: "go",
    name: "Go",
    tagline: "One team, one assistant, answering from your own content.",
    featuresLabel: "Everything you need to launch:",
    features: [
      "Unlimited assistants, edited beside a live widget preview",
      "Knowledge from websites, files and FAQs, re-crawled weekly",
      "Grounded answers that cite the exact Source behind them",
      "Publish as a website floater or an embedded iframe",
      "Conversation inbox, insights dashboard and help-desk escalation",
      "Tenant isolation, role-based access and single sign-on for admins",
    ],
    checkoutPlan: "go",
    salesCta: "Request access",
    recommended: false,
  },
  {
    slug: "business",
    name: "Business",
    tagline: "Several assistants across departments, wired into your systems.",
    featuresLabel: "Everything in Go, plus:",
    features: [
      "Bring your own model keys, and pick the model per assistant",
      "Crawl JavaScript-heavy and login-protected sites",
      "Advanced flow actions: API requests, email, handover",
      "Ticketing integrations that open a real case on escalation",
      // Trend reports and exports are routed but stubbed (ARCHITECTURE §12), so
      // this line advertises the alerting that actually ships today.
      "Operational alerts when an integration's credentials stop working",
      "Priority support",
    ],
    checkoutPlan: "business",
    salesCta: "Request access",
    recommended: true,
  },
  {
    slug: "enterprise",
    name: "Enterprise",
    tagline: "Institution-wide rollout, on your own cloud account and terms.",
    featuresLabel: "Everything in Business, plus:",
    features: [
      "Keyless federated access to Vertex, Anthropic and Azure OpenAI",
      "Model spend billed to your own cloud account, not resold through us",
      "Organization-wide usage caps and budget controls",
      "Extended runtime-event retention for audit and review",
      "Self-hosting on the AGPL core",
      "DPA, Standard Contractual Clauses and security review support",
      "Onboarding, a named contact and an availability commitment",
    ],
    // Sales-led on purpose: Enterprise carries custom terms, an availability
    // commitment and often tenant-billed models — none of it a card can settle.
    checkoutPlan: null,
    salesCta: "Talk to sales",
    recommended: false,
  },
];

/**
 * The shared plan-card shell: every card tilts towards the cursor.
 *
 * `overflow-visible` overrides TiltCard's own clip — `Card` draws its outline
 * as a ring, which sits outside the padding box and would be clipped away
 * entirely, taking the "Most popular" highlight with it. The glare rounds
 * itself to the same radius instead of relying on that clip.
 *
 * The glare is also turned well down from its default: it is painted at rest,
 * not just under the pointer, and at full strength it washes a 900px card of
 * body copy grey.
 */
export function PlanTilt({ children }: { children: React.ReactNode }) {
  return (
    <TiltCard
      max={7}
      glareOpacity={0.06}
      invert
      className="h-full overflow-visible rounded-xl"
    >
      {children}
    </TiltCard>
  );
}

/**
 * One CTA look for the whole page, in both themes: an outlined pill at rest that
 * inverts to a filled one with a faint halo on hover.
 *
 * Every plan card carries the same button on purpose. Which plan we suggest is
 * already said twice — the ring and the badge — and saying it a third time with
 * a filled button made the other three cards' CTAs read as the disabled
 * alternatives to it. The recommendation also *moves* with the answers slider
 * while a variant chosen per tier cannot, so the filled button regularly
 * disagreed with the ringed card.
 *
 * `text-foreground` is explicit rather than inherited: these buttons sit on a
 * translucent card over the page's own gradient, and inheriting a muted colour
 * from an ancestor is how the label ends up unreadable at rest. The hover half
 * restates the `default` variant's invert so `outline` borrows it —
 * tailwind-merge drops `outline`'s own `hover:bg-*`/`hover:text-*` in favour of
 * these, which is why they stay a className rather than move into the variant.
 */
export const CTA_CLASS =
  "text-foreground hover:bg-primary hover:text-primary-foreground hover:shadow-[0_0_14px_rgba(0,0,0,0.18)] dark:hover:bg-none dark:hover:bg-primary dark:hover:text-primary-foreground dark:hover:shadow-[0_0_14px_rgba(255,255,255,0.28)]";
