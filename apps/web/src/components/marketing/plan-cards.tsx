import React from "react";
import { TiltCard } from "@/components/motion/tilt-card";

/**
 * The Enterprise offering as copy, plus the two bits of card presentation the
 * pricing page (and the download page's CTA) share: the tilt shell and the CTA
 * look.
 *
 * There is deliberately no ladder here. Ciele is offered exactly two ways —
 * self-hosted (free, open source) and Enterprise (managed, sales-led) — and the
 * self-hosted half is not a purchasable tier at all, so the only offering this
 * module describes is the one sales sells. No price appears either: Enterprise
 * is sized in a conversation, and printing a number here is how a marketing
 * page and an agreement start disagreeing.
 */

/**
 * What the pricing page says about Enterprise that is NOT a number: who it is
 * for, what having us run the platform adds over running the open-source core
 * yourself, and how you buy it (a conversation, always).
 *
 * Feature lines describe what the platform does today (see docs/ARCHITECTURE.md
 * §12 for the shipped-vs-inert breakdown). The last two lines are contractual
 * rather than product: commitments sales makes, not switches.
 */
export const ENTERPRISE = {
  /** What Stripe, support and the console all call it. */
  slug: "enterprise",
  name: "Enterprise",
  tagline: "We run Ciele for you: institution-wide rollout, on your own cloud account and terms.",
  featuresLabel: "Everything in the open-source core, plus:",
  features: [
    "Hosting, upgrades and backups, operated by us",
    "A monthly AI allowance on our provider accounts, sized with you",
    "Bring your own model keys, or keyless federated access to Vertex, Anthropic and Azure OpenAI",
    "Crawl JavaScript-heavy and login-protected sites",
    "Ticketing integrations that open a real case on escalation",
    "Organization-wide usage caps and budget controls",
    "DPA, Standard Contractual Clauses and security review support",
    "Onboarding, a named contact and an availability commitment",
  ],
  // Sales-led on purpose: Enterprise carries custom terms, an availability
  // commitment and often tenant-billed models — none of it a card can settle.
  salesCta: "Talk to sales",
} as const;

/**
 * The shared plan-card shell: every card tilts towards the cursor.
 *
 * `overflow-visible` overrides TiltCard's own clip — `Card` draws its outline
 * as a ring, which sits outside the padding box and would be clipped away
 * entirely. The glare rounds itself to the same radius instead of relying on
 * that clip.
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
 * Both cards carry the same button on purpose: with exactly two offerings that
 * answer different questions — "do we run it or do you?" — neither is the
 * recommended one, and a filled button on one card would make the other read as
 * the disabled alternative.
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
