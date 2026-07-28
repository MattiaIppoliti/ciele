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
import { planTierViews, type PlanTierView } from "@/lib/plan-pricing";
import {
  BouncyAccordion,
  type BouncyAccordionItem,
} from "@/components/motion/bouncy-accordion";
import { GridBeam } from "@/components/motion/grid-beam";

/**
 * What this page says about each tier that is NOT a number: who it is for, what
 * it unlocks, and how you buy it.
 *
 * Every price and every included volume is deliberately absent here. Those
 * arrive as a `PlanCatalog` from the enterprise billing seam — one ladder,
 * derived from the allowance constants the caps actually enforce and priced at
 * `PLAN_PRICE_EUR`, which is also what the Stripe products charge. Restating a
 * price in this file is how a marketing page and an invoice start disagreeing,
 * so the only pricing this component owns is the layout it renders it in.
 *
 * A deployment with no catalog (the open-source edition, which ships no
 * `src/ee`) therefore has no prices to publish, and the cards say so instead of
 * advertising a ladder that cannot be bought.
 *
 * Feature lines describe what the platform does today (see docs/ARCHITECTURE.md
 * §12 for the shipped-vs-inert breakdown). Enterprise's last two lines are
 * contractual rather than product: commitments sales makes, not switches.
 */
interface Tier {
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

const TIERS: Tier[] = [
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

const [GO, BUSINESS, ENTERPRISE] = TIERS;

/** `true` renders a check, `false` a dash, a string renders verbatim. */
type ComparisonCell = boolean | string;

const COMPARISON_COLUMNS = [
  "Self-hosted",
  GO.name,
  BUSINESS.name,
  ENTERPRISE.name,
] as const;

/**
 * Feature matrix, in the column order above. The self-hosted column is the
 * AGPL mirror: it carries the whole open-source product but none of the paths
 * the mirror strips (`scripts/mirror-gate` EE_PATHS) — no billing, no plan
 * metering, no managed SSO onboarding, no staff console — and it has no
 * platform-funded models, so its own provider keys are mandatory rather than
 * optional.
 *
 * Its cells therefore say what the self-hoster PROVIDES, never a bare check.
 * A tick reads as "included", and on this column the same capability is work
 * the reader takes on — a matrix where the free column collects more ticks than
 * the plans above it is not generous, it is wrong, and it argues against every
 * plan on the page.
 *
 * The two priced rows are a function of the catalog for the same reason the
 * cards are: there is one ladder, and it is not stated here.
 */
function comparisonRows(
  views: Map<string, PlanTierView>
): Array<{ label: string; cells: ComparisonCell[] }> {
  const price = (tier: Tier) => {
    const view = views.get(tier.slug);
    if (!view) return "Let’s talk";
    return view.pricePrefix
      ? `${view.pricePrefix} ${view.priceLabel}`
      : view.priceLabel;
  };
  // The answer volume, the one line a reader compares tier to tier. The crawl
  // and indexing volumes are on the cards; repeating all three here would make
  // the row three lines tall in a column an eighth of the page wide.
  const answers = (tier: Tier) => views.get(tier.slug)?.volumes[0] ?? "Sized with you";

  return [
    {
      label: "Monthly price",
      cells: ["Free", price(GO), price(BUSINESS), price(ENTERPRISE)],
    },
    {
      label: "Included AI usage",
      cells: [
        "Your own bill",
        answers(GO),
        answers(BUSINESS),
        answers(ENTERPRISE),
      ],
    },
    {
      label: "Model credentials included",
      cells: [false, true, true, true],
    },
    {
      label: "Hosting, updates and backups",
      cells: ["You run it", "Managed", "Managed", "Managed"],
    },
    {
      label: "Plan allowance, usage gauges and caps",
      cells: [false, true, true, true],
    },
    { label: "Unlimited assistants and flows", cells: [true, true, true, true] },
    { label: "Website, file and FAQ knowledge", cells: [true, true, true, true] },
    { label: "Grounded answers with citations", cells: [true, true, true, true] },
    {
      label: "Inbox, insights and improvements",
      cells: [true, true, true, true],
    },
    { label: "Help desks and escalation", cells: [true, true, true, true] },
    {
      label: "Bring your own model keys",
      cells: ["Required", false, true, true],
    },
    {
      label: "Crawl JavaScript-heavy and gated sites",
      cells: ["You host the crawler", false, true, true],
    },
    {
      label: "Ticketing integrations",
      cells: ["You configure it", false, true, true],
    },
    {
      label: "Keyless federated model access",
      cells: ["Your own cloud setup", false, false, true],
    },
    {
      label: "Managed SSO onboarding",
      cells: [false, false, true, true],
    },
    {
      label: "DPA, SCCs and security review",
      cells: [false, false, false, true],
    },
    {
      label: "Support",
      cells: ["Community", "Email", "Priority", "Named contact"],
    },
    {
      label: "Uptime and response commitment",
      cells: [false, false, false, true],
    },
  ];
}

export function PricingContent({
  billingEnabled,
  catalog,
}: {
  /**
   * Whether this deployment can actually take a card (Stripe configured, and
   * the enterprise checkout route present). The open-source mirror ships
   * neither, so its buttons must lead to sales instead of a 404.
   */
  billingEnabled: boolean;
  /**
   * The purchasable ladder — prices and allowance-derived volumes — or null on a
   * deployment that sells nothing.
   */
  catalog: PlanCatalog | null;
}) {
  /** The catalog's tiers, keyed by slug so a card can find its own numbers. */
  const views = React.useMemo(() => {
    const entries = planTierViews(catalog?.tiers ?? null);
    return new Map(entries.map((view) => [view.slug, view]));
  }, [catalog]);
  const rows = React.useMemo(() => comparisonRows(views), [views]);
  const basis = catalog?.answerBasis ?? null;

  const cta = (tier: Tier): { label: string; href: string } =>
    billingEnabled && tier.checkoutPlan
      ? {
          label: "Get started",
          href: `/api/ee/stripe/checkout?plan=${tier.checkoutPlan}`,
        }
      : { label: tier.salesCta, href: "/contact/sales" };

  return (
    <main className="relative px-4 pb-24 pt-28 sm:px-8 sm:pt-36 lg:px-12">
      <div className="mx-auto w-full max-w-6xl">
        {/* Hero */}
        <div className="max-w-3xl">
          <p className="text-muted-foreground font-mono text-xs font-medium uppercase tracking-wider">
            Pricing
          </p>
          <h1 className="text-foreground mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
            Pricing that scales with your usage
          </h1>
          <p className="text-muted-foreground mt-6 text-lg leading-relaxed">
            Every plan includes the whole product — assistants, knowledge, flows,
            inbox and insights — for as many members as you like. What changes is
            how much AI work the plan funds each month, and how deeply Ciele
            plugs into your existing systems.
          </p>
        </div>

        {/* What the plan meters, stated before any number below it: an
            allowance is only readable once you know what it is spent on. */}
        <div className="border-border bg-card/60 mt-12 rounded-2xl border p-6 backdrop-blur-sm sm:p-8">
          <p className="text-foreground text-base font-semibold">
            What a plan pays for
          </p>
          <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
            Members are unlimited on every plan, and visitors chatting with a
            published widget are never counted. What a plan meters is the AI work
            the platform funds on your behalf: answering questions, crawling your
            sites and indexing your documents. Each plan below states that
            allowance as the volumes it covers, and your Usage page shows exactly
            where you are against it.
          </p>
          {basis ? (
            <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
              Answer volumes are quoted on{" "}
              <span className="text-foreground font-medium">
                {basis.quotedModel}
              </span>
              , the lightest model on the platform. Which model your assistants
              run is your choice and it moves this a lot: on{" "}
              {basis.frontierModel} — what a new assistant starts with — one
              answer costs roughly {basis.frontierFactor}× more, so the same
              allowance covers proportionally fewer.
            </p>
          ) : null}
        </div>

        {/* Tier cards */}
        {/* Stretch, not items-start: the three lists are close enough in length
            now that equal-height cards line the CTAs up for comparison. */}
        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          {TIERS.map((tier) => (
            <Card
              key={tier.name}
              className={cn(
                "bg-card/60 relative gap-0 backdrop-blur-sm [--card-spacing:--spacing(6)]",
                tier.recommended && "ring-2 ring-primary"
              )}
            >
              <CardHeader>
                <div className="flex items-center gap-2">
                  <CardTitle className="text-foreground text-lg font-semibold">
                    {tier.name}
                  </CardTitle>
                  {tier.recommended && <Badge>Most popular</Badge>}
                </div>
                <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
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
                <p className="text-muted-foreground mt-1.5 text-xs">
                  {views.has(tier.slug)
                    ? "Unlimited members. Cancel or change in the billing portal."
                    : "Priced to your usage, once we have sized it with you."}
                </p>
                {views.has(tier.slug) && (
                  <div className="border-border/60 mt-4 rounded-lg border border-dashed px-3 py-2.5">
                    <p className="text-foreground text-xs font-semibold">
                      Included each month:
                    </p>
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
                  </div>
                )}
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
                {/* Checkout is a server redirect chain out to Stripe, so it is
                    a plain <a>: next/link would try to prefetch and soft-
                    navigate a route that only ever answers with a 303. */}
                <Button
                  className="h-9 w-full"
                  variant={tier.recommended ? "default" : "outline"}
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
          ))}
        </div>

        {/* Notes — centred under the three-column card row rather than hugging
            the left edge, which read as a stray column against the grid. */}
        <div className="mx-auto mt-12 max-w-3xl text-center">
          <p className="text-sm leading-relaxed">
            <span className="text-muted-foreground">
              Need more than the top plan funds, a multi-campus rollout, or
              procurement requirements?{" "}
            </span>
            <Link
              href="/contact/sales"
              className="text-foreground font-medium underline underline-offset-4"
            >
              Talk to sales
            </Link>
            <span className="text-muted-foreground">
              {" "}
              and we will quote it properly.
            </span>
          </p>
        </div>

        {/* Comparison matrix */}
        <div className="mt-20">
          <h2 className="text-foreground text-center text-2xl font-semibold tracking-tight">
            Compare every plan
          </h2>
          <p className="text-muted-foreground mx-auto mt-3 max-w-2xl text-center text-sm leading-relaxed">
            Ciele is open source under the AGPL, so running it yourself is
            always an option — you bring the infrastructure and the model
            account, and you keep the whole product.
          </p>

          {/* Five columns will not fit a phone; scroll the grid inside its own
              container rather than letting the page scroll sideways. */}
          <div className="mt-8 overflow-x-auto">
            <GridBeam
              className="border-border/70 min-w-[820px] overflow-hidden rounded-2xl border"
              cols={COMPARISON_COLUMNS.length + 1}
              columnsTemplate="minmax(0, 1.7fr) repeat(4, minmax(0, 1fr))"
              rows={rows.length + 1}
            >
              {/* Header row: an empty corner cell, then the plan names. */}
              <div className="px-4 py-3.5" />
              {COMPARISON_COLUMNS.map((column) => (
                <div
                  key={column}
                  className={cn(
                    "px-4 py-3.5 font-mono text-[10.5px] font-medium uppercase tracking-widest",
                    column === BUSINESS.name
                      ? "text-foreground"
                      : "text-muted-foreground"
                  )}
                >
                  {column}
                </div>
              ))}

              {rows.map((row) => (
                <React.Fragment key={row.label}>
                  <div className="text-foreground px-4 py-3.5 text-sm leading-snug">
                    {row.label}
                  </div>
                  {row.cells.map((cell, index) => (
                    <div
                      key={`${row.label}-${COMPARISON_COLUMNS[index]}`}
                      className="text-muted-foreground px-4 py-3.5 text-sm leading-snug tabular-nums"
                    >
                      {cell === true ? (
                        <>
                          <Check
                            aria-hidden="true"
                            className="text-foreground size-4"
                            strokeWidth={2.25}
                          />
                          <span className="sr-only">Included</span>
                        </>
                      ) : cell === false ? (
                        <>
                          <span aria-hidden="true" className="opacity-40">
                            —
                          </span>
                          <span className="sr-only">Not included</span>
                        </>
                      ) : (
                        cell
                      )}
                    </div>
                  ))}
                </React.Fragment>
              ))}
            </GridBeam>
          </div>
        </div>

        {/* FAQ — the block is centred, but each row stays left-aligned: a
            question centred against its own chevron reads as a layout bug,
            not as a choice. */}
        <div className="mx-auto mt-20 max-w-3xl">
          <h2 className="text-foreground text-center text-2xl font-semibold tracking-tight">
            Frequently asked questions
          </h2>
          <BouncyAccordion
            className="mt-6 text-left"
            items={FAQ_ITEMS}
            classNames={{
              // Match the translucent surfaces the rest of the page sits on,
              // so the rows read as part of the sky shell rather than as opaque
              // cards pasted over it.
              item: "bg-card/60 ring-1 ring-border/60 backdrop-blur-sm",
              title: "whitespace-normal text-wrap",
            }}
          />
        </div>
      </div>
    </main>
  );
}

const FAQ_ITEMS: BouncyAccordionItem[] = [
  {
    id: "allowance",
    title: "What does the included allowance actually cover?",
    description:
      "The AI work the platform funds for you: answering questions, crawling your sites and indexing your documents. Each plan states that as volumes — answers, pages, documents — and all three draw on the same monthly allowance, so a month spent indexing a large site leaves less for answering, and the other way round. Your Usage page shows the split as it happens.",
  },
  {
    id: "why-not-tokens",
    title: "Why volumes instead of tokens?",
    description:
      "Because tokens are our unit, not yours. A plan's allowance is denominated in cost, which we then restate as the volumes that cost funds — so the plan means the same thing whichever model your assistants run. A frontier model spends the allowance faster and covers proportionally fewer answers; it never quietly costs you more than the plan.",
  },
  {
    id: "run-out",
    title: "What happens if we use up the allowance?",
    description:
      "Assistants keep working while you are inside it, and the console warns you as you approach the cap. Each allowance is also capped per week, so a busy few days cannot spend the month. On Business and Enterprise you can connect your own provider keys or a federated cloud account, in which case that model usage is billed to you directly and is never counted against a plan.",
  },
  {
    id: "visitors",
    title: "Do members or chat visitors cost extra?",
    description:
      "Neither. Members with console access are unlimited on every plan, and students, staff and website visitors chatting with a published widget are never counted or charged. Plans meter the AI work, not the people.",
  },
  {
    id: "byok",
    title: "Can we bring our own models?",
    description:
      "Yes, from Business up. Connect your own Anthropic, OpenAI or Google key, or any OpenAI-compatible endpoint including a self-hosted one. Enterprise adds keyless federated access — Google Vertex, Anthropic workload identity or Azure OpenAI — so no long-lived key is ever stored with us.",
  },
  {
    id: "switch",
    title: "Can we switch plans later?",
    description:
      "Yes. Plans change from the console and take effect on the next billing period; your assistants, knowledge and history carry over untouched.",
  },
  {
    id: "education",
    title: "Do you offer education or non-profit pricing?",
    description:
      "We do. Ciele is built for institutions, and we quote academic and non-profit rollouts case by case — get in touch and we will work it out with you.",
  },
];
