"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import React from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  cn,
} from "@agent-hub/ui";
import type { PlanCatalog } from "@agent-hub/agent";
import {
  maxPublishedAnswers,
  planViewsBySlug,
  recommendedTierSlug,
} from "@/lib/plan-pricing";
import { RangeSlider } from "@/components/motion/range-slider";
import { CTA_CLASS, PlanTilt, TIERS, type Tier } from "./plan-cards";

/**
 * The only interactive part of the pricing page: the answers picker, and the
 * plan cards whose highlight follows it.
 *
 * It is one island rather than two because the picker's recommendation is what
 * rings a card and badges it, and the two sit in sibling regions of the page.
 * Everything static around them — the hero, the metering note, the self-hosted
 * card, the comparison matrix, the install section and the FAQ — stays on the
 * server and arrives here already rendered, either as this component's siblings
 * or through the two slots below.
 */

/**
 * The picker's range, in answers a month. The floor is a genuinely small pilot;
 * the ceiling comes from the catalog at render time, because the dearest plan's
 * volume is the last point where recommending a published plan is honest. The
 * step is coarse on purpose — this is an estimate a visitor makes about their
 * own year, not a quote.
 */
const MIN_ANSWERS = 500;
const ANSWER_STEP_SIZE = 500;
const DEFAULT_ANSWERS = 5_000;

export function PlanPicker({
  billingEnabled,
  catalog,
  meteringNote,
  selfHostedCard,
}: {
  /** Whether this deployment can take a card — see `PricingContent`. */
  billingEnabled: boolean;
  /** The purchasable ladder, or null — see `PricingContent`. */
  catalog: PlanCatalog | null;
  /** Server-rendered: what a plan meters, stated above the cards. */
  meteringNote: React.ReactNode;
  /** Server-rendered: the free edition's card, first in the card grid. */
  selfHostedCard: React.ReactNode;
}) {
  /** The catalog's tiers, keyed by slug so a card can find its own numbers. */
  const views = React.useMemo(() => planViewsBySlug(catalog?.tiers ?? null), [
    catalog,
  ]);

  /**
   * The picker: how many answers a month the visitor expects, and the cheapest
   * published plan whose allowance funds them. The rule itself lives in
   * `lib/plan-pricing` — see `recommendedTierSlug` for why it recommends by
   * answers and why it can recommend nothing at all.
   *
   * It may only recommend a tier this grid renders a card for, hence the slugs:
   * a recommendation nothing on the page can highlight is worse than none.
   */
  const [answersWanted, setAnswersWanted] = React.useState(DEFAULT_ANSWERS);
  const maxAnswers = maxPublishedAnswers(catalog?.tiers ?? null) ?? DEFAULT_ANSWERS;
  const recommendedSlug = recommendedTierSlug(
    catalog?.tiers ?? null,
    answersWanted,
    TIERS.map((tier) => tier.slug)
  );
  const recommended = TIERS.find((tier) => tier.slug === recommendedSlug) ?? null;

  /**
   * Which card is ringed. The picker's answer when it has one, so the highlight
   * responds to the reader; the static "most popular" flag otherwise, which is
   * also what a deployment with no catalog falls back to.
   */
  const highlighted = (tier: Tier): boolean =>
    catalog ? recommended?.slug === tier.slug : tier.recommended;

  const cta = (tier: Tier): { label: string; href: string } =>
    billingEnabled && tier.checkoutPlan
      ? {
          label: "Get started",
          href: `/api/ee/stripe/checkout?plan=${tier.checkoutPlan}`,
        }
      : { label: tier.salesCta, href: "/contact/sales" };

  return (
    <>
      {/* What the plan meters, stated before any number below it: an
          allowance is only readable once you know what it is spent on. */}
      <div className="border-border bg-card/60 mt-12 rounded-2xl border p-6 backdrop-blur-sm sm:p-8">
        {/* The picker only exists where there is a ladder to point at: with no
            catalog there are no volumes to compare an estimate against. */}
        {catalog ? (
          <div className="border-border/60 mb-6 border-b pb-6">
            <div className="flex items-center justify-between gap-4">
              <p className="text-foreground text-base font-semibold">
                Answers a month
              </p>
              <div className="bg-primary/10 flex items-baseline gap-1.5 rounded-full px-3.5 py-1.5">
                <span className="text-primary text-xl font-semibold tabular-nums">
                  {answersWanted.toLocaleString("en-US")}
                </span>
                <span className="text-muted-foreground text-sm">answers</span>
              </div>
            </div>
            {/* The visible heading above is a plain paragraph rather than a
                label: the thumb is the `role="slider"` element, and only
                `aria-label` reaches it. */}
            <RangeSlider
              className="mt-5"
              aria-label="Answers a month"
              value={answersWanted}
              min={MIN_ANSWERS}
              max={maxAnswers}
              step={ANSWER_STEP_SIZE}
              onValueChange={setAnswersWanted}
            />
            <div className="text-muted-foreground mt-1.5 flex justify-between text-xs tabular-nums">
              <span>{MIN_ANSWERS.toLocaleString("en-US")}</span>
              <span>{Math.round(maxAnswers / 2).toLocaleString("en-US")}</span>
              <span>{maxAnswers.toLocaleString("en-US")}</span>
            </div>
            <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
              {recommended
                ? `${recommended.name} funds about that much answering, it is marked below. Crawling and indexing draw on the same allowance, so a heavy indexing month leaves less for answers.`
                : "That is more than the published plans fund. Enterprise is sized in a conversation, so tell us the number and we will quote it."}
            </p>
          </div>
        ) : null}
        {meteringNote}
      </div>

      {/* Tier cards */}
      {/* Stretch, not items-start: the four lists are close enough in length
          now that equal-height cards line the CTAs up for comparison. Two
          columns on tablets, four from `xl` — at `lg` a quarter of the
          container is too narrow for the price line to hold one line. */}
      <div className="mt-8 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {/* Free edition first, matching the comparison grid's column order
            and the usual cheapest-to-dearest read. */}
        {selfHostedCard}

        {TIERS.map((tier) => (
          <PlanTilt key={tier.name}>
            <Card
              className={cn(
                "bg-card/60 h-full gap-0 backdrop-blur-sm [--card-spacing:--spacing(6)]",
                highlighted(tier) && "ring-primary ring-2"
              )}
            >
              <CardHeader>
                <div className="flex items-center gap-2">
                  <CardTitle className="text-foreground text-lg font-semibold">
                    {tier.name}
                  </CardTitle>
                  {/* The badge follows the picker where there is one: a card
                      the reader's own estimate landed on is more use to them
                      than which card sells most. */}
                  {highlighted(tier) && (
                    <Badge>
                      {recommended?.slug === tier.slug
                        ? "Fits your usage"
                        : "Most popular"}
                    </Badge>
                  )}
                </div>
                {/* Two-line floor, same as the self-hosted card, so all four
                    feature lists start at the same height. */}
                <p className="text-muted-foreground mt-1 min-h-17 text-sm leading-relaxed">
                  {tier.tagline}
                </p>
                {/* Price and volumes come from the catalog, so a tier the
                    catalog does not carry says so rather than inventing one. */}
                <div className="mt-6 flex items-baseline gap-1.5">
                  {views.get(tier.slug)?.pricePrefix && (
                    <span className="text-muted-foreground text-sm">
                      {views.get(tier.slug)?.pricePrefix}
                    </span>
                  )}
                  <span className="text-foreground text-4xl font-semibold tabular-nums">
                    {views.get(tier.slug)?.priceLabel ?? "Let’s talk"}
                  </span>
                  {views.has(tier.slug) && (
                    <span className="text-muted-foreground text-sm">
                      / month
                    </span>
                  )}
                </div>
                <p className="text-muted-foreground mt-1.5 min-h-8 text-xs">
                  {views.has(tier.slug)
                    ? "Unlimited members. Change or cancel in the billing portal."
                    : "Priced to your usage, once we have sized it with you."}
                </p>
                <div className="border-border/60 mt-4 min-h-38 rounded-lg border border-dashed px-3 py-2.5">
                  <p className="text-foreground text-xs font-semibold">
                    Included each month:
                  </p>
                  {views.has(tier.slug) ? (
                    <ul className="mt-1.5 space-y-1">
                      {views.get(tier.slug)?.volumes.map((line) => (
                        <li
                          key={line}
                          className="text-muted-foreground text-xs leading-relaxed tabular-nums"
                        >
                          {line}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">
                      Sized with you, then written into the agreement.
                    </p>
                  )}
                </div>
              </CardHeader>

              <CardContent className="mt-6 flex-1">
                <p className="text-foreground text-xs font-semibold">
                  {tier.featuresLabel}
                </p>
                <ul className="mt-3 space-y-2.5">
                  {tier.features.map((feature) => (
                    <li key={feature} className="flex gap-2.5 text-sm">
                      <Check
                        aria-hidden="true"
                        className="text-primary mt-0.5 size-4 shrink-0"
                        strokeWidth={2.25}
                      />
                      <span className="text-muted-foreground leading-relaxed">
                        {feature}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>

              <CardFooter className="mt-6">
                {/* Checkout is a server redirect chain out to Stripe, so it
                    is a plain <a>: next/link would try to prefetch and soft-
                    navigate a route that only ever answers with a 303. */}
                <Button
                  className={cn("h-9 w-full", CTA_CLASS)}
                  variant="outline"
                  nativeButton={false}
                  render={
                    billingEnabled && tier.checkoutPlan ? (
                      <a href={cta(tier).href} />
                    ) : (
                      <Link href={cta(tier).href} />
                    )
                  }
                >
                  <span>{cta(tier).label}</span>
                </Button>
              </CardFooter>
            </Card>
          </PlanTilt>
        ))}
      </div>
    </>
  );
}
