"use client";

import Link from "next/link";
import { ArrowDown, Check, Minus } from "lucide-react";
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
import { RangeSlider } from "@/components/motion/range-slider";
import { TiltCard } from "@/components/motion/tilt-card";
import { CodeBlock } from "@/components/ui/code-block";

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

/**
 * The fourth card, and deliberately not a `Tier`: nothing about it moves with
 * the catalog (it is not a purchasable tier), it has no monthly price and no
 * included allowance, and its CTA leads to the install section further down this
 * page rather than to checkout or to sales.
 *
 * Its feature lines are the open-source core as documented in
 * `apps/docs/content/docs/self-hosting/open-core-boundary.mdx` — the whole
 * product minus what the mirror gate strips (billing, plan metering, the staff
 * console, managed SSO onboarding, and anything with a service commitment).
 *
 * Ticks and burdens are two fields on purpose, for the reason the comparison
 * matrix keeps bare checks off this column: a tick reads as "included", and the
 * free column collecting as many of them as the plans above it argues against
 * every plan on the page. So the ticks stop at the capabilities, and stay fewer
 * than Go's; what the self-hoster takes on renders below them as a burden, not
 * as a benefit.
 */
const SELF_HOSTED = {
  name: "Self-hosted",
  tagline: "Run the open-source core yourself, on your own infrastructure.",
  featuresLabel: "The whole open-source core:",
  features: [
    "The same admin console, editor and chat widget, AGPL-3.0 licensed",
    "Knowledge from websites, files and FAQs, with source citations",
    "Flow router, help desks, inbox, insights, improvements and alerts",
    "Organizations, members, roles and row-level security",
  ],
  burdensLabel: "What you take on:",
  burdens: [
    "Your own provider keys, or a local model server, and their bill",
    "The servers, the upgrades and the backups; support is the community",
  ],
  /** Anchor of the install section rendered below the comparison grid. */
  anchor: "self-hosted",
} as const;

/** `true` renders a check, `false` a dash, a string renders verbatim. */
type ComparisonCell = boolean | string;

const COMPARISON_COLUMNS = [
  SELF_HOSTED.name,
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
function PlanTilt({ children }: { children: React.ReactNode }) {
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
const CTA_CLASS =
  "text-foreground hover:bg-primary hover:text-primary-foreground hover:shadow-[0_0_14px_rgba(0,0,0,0.18)] dark:hover:bg-none dark:hover:bg-primary dark:hover:text-primary-foreground dark:hover:shadow-[0_0_14px_rgba(255,255,255,0.28)]";

/**
 * The open-source repository — where "View the source" goes and what the quick
 * start clones. Writing it out is deliberate: an install command a reader has to
 * fill in themselves is not an install command.
 *
 * Overridable so a fork points at itself rather than at us.
 */
const SOURCE_URL =
  process.env.NEXT_PUBLIC_SOURCE_URL || "https://github.com/MattiaIppoliti/ciele";

/**
 * Getting the open-source edition running. The commands are the ones from
 * `apps/docs/content/docs/self-hosting/installation.mdx`; if those change, they
 * change here too — a pricing page that promises a broken quick start is worse
 * than one that promises nothing.
 */
const INSTALL_TABS = [
  {
    label: "Quick start",
    language: "bash",
    // Copy-pasteable as printed. `SOURCE_URL` is a build-time constant, so a
    // fork that sets NEXT_PUBLIC_SOURCE_URL gets its own address here too.
    code: `git clone ${SOURCE_URL}.git && cd ciele
pnpm install
pnpm dev`,
  },
  {
    label: "With a database",
    language: "bash",
    // Comments sit on their own lines rather than padded to a column: the
    // block wraps instead of scrolling sideways, and aligned trailing comments
    // wrap into nonsense the moment the column is narrow.
    code: `# Boot the local Postgres stack (needs Docker)
pnpm db:start

# Apply migrations and seed data
pnpm db:reset

# Local credentials come pre-filled
cp apps/web/.env.example apps/web/.env.local

pnpm dev`,
  },
  {
    label: ".env.local",
    language: "bash",
    code: `# Database, set all three and the app leaves demo mode
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# At least one model provider (or an OpenAI-compatible endpoint)
GOOGLE_GENERATIVE_AI_API_KEY=

# Seals per-organization provider keys at rest
APP_ENCRYPTION_KEY=`,
  },
];

/** The three things a self-hosted deployment has to supply itself. */
const INSTALL_REQUIREMENTS = [
  {
    title: "Node.js and pnpm",
    detail:
      "The apps are standard Next.js applications; anywhere that runs Node can host them.",
  },
  {
    title: "A Postgres database",
    detail:
      "Supabase provides the database, authentication and row-level security. Docker runs the whole stack locally.",
  },
  {
    title: "Your own model keys",
    detail:
      "Any supported provider, or point at an OpenAI-compatible endpoint to run the models locally too.",
  },
];

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

  /**
   * The picker: how many answers a month the visitor expects, and the cheapest
   * published plan whose allowance funds them.
   *
   * It picks by ANSWERS rather than by team size because that is what a plan
   * meters — members are unlimited — and the answer count is the one volume a
   * prospect can estimate about themselves. The recommendation walks the catalog
   * cheapest-first, so it moves with the allowances rather than with a table
   * written here. Above the dearest published volume nothing is recommended: the
   * honest answer there is a conversation, not the top card.
   */
  const [answersWanted, setAnswersWanted] = React.useState(DEFAULT_ANSWERS);
  /** The dearest published answer volume — the top of the slider's range. */
  const maxAnswers = React.useMemo(() => {
    const volumes = (catalog?.tiers ?? []).map((entry) => entry.volumes.answers);
    return volumes.length > 0 ? Math.max(...volumes) : DEFAULT_ANSWERS;
  }, [catalog]);
  const recommended = React.useMemo(
    () =>
      TIERS.find((tier) => {
        const answers = catalog?.tiers.find(
          (entry) => entry.slug === tier.slug
        )?.volumes.answers;
        return answers != null && answers >= answersWanted;
      }) ?? null,
    [catalog, answersWanted]
  );

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
    <main className="relative px-4 pb-8 pt-28 sm:px-8 sm:pt-36 lg:px-12">
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
            Every plan includes the whole product, assistants, knowledge, flows,
            inbox and insights, for as many members as you like. What changes is
            how much AI work the plan funds each month, and how deeply Ciele
            plugs into your existing systems.
          </p>
        </div>

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
              {basis.frontierModel}, the usual step up when you want a stronger
              answer, one answer costs roughly {basis.frontierFactor}× more, so
              the same allowance covers proportionally fewer.
            </p>
          ) : null}
        </div>

        {/* Tier cards */}
        {/* Stretch, not items-start: the four lists are close enough in length
            now that equal-height cards line the CTAs up for comparison. Two
            columns on tablets, four from `xl` — at `lg` a quarter of the
            container is too narrow for the price line to hold one line. */}
        <div className="mt-8 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {/* Free edition first, matching the comparison grid's column order
              and the usual cheapest-to-dearest read. */}
          <PlanTilt>
            <Card className="bg-card/60 h-full gap-0 backdrop-blur-sm [--card-spacing:--spacing(6)]">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <CardTitle className="text-foreground text-lg font-semibold">
                    {SELF_HOSTED.name}
                  </CardTitle>
                  <Badge variant="outline">Open source</Badge>
                </div>
                {/* Two-line floor on the tagline and a fixed height on the
                    allowance box below: the four cards then reach their feature
                    list at the same y, which is what makes the lists
                    comparable. See the same two classes on the tier cards. */}
                <p className="text-muted-foreground mt-1 min-h-17 text-sm leading-relaxed">
                  {SELF_HOSTED.tagline}
                </p>
                {/* No catalog lookup here: the open-source edition is not a
                    purchasable tier, so its price is the licence, not data. */}
                <div className="mt-6 flex items-baseline gap-1.5">
                  <span className="text-foreground text-4xl font-semibold">
                    Free
                  </span>
                  <span className="text-muted-foreground text-sm">
                    / forever
                  </span>
                </div>
                {/* Two-line floor, as on the tier cards: their note wraps and
                    this one does not, and a 16px offset would carry down into
                    every row below it. */}
                <p className="text-muted-foreground mt-1.5 min-h-8 text-xs">
                  AGPL-3.0, no plan, no allowance
                </p>
                <div className="border-border/60 mt-4 min-h-38 rounded-lg border border-dashed px-3 py-2.5">
                  <p className="text-foreground text-xs font-semibold">
                    Included each month:
                  </p>
                  <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">
                    Nothing, the AI work is billed to your own provider account,
                    or runs on a model server you host.
                  </p>
                </div>
              </CardHeader>

              <CardContent className="mt-6 flex-1">
                <p className="text-foreground text-xs font-semibold">
                  {SELF_HOSTED.featuresLabel}
                </p>
                <ul className="mt-3 space-y-2.5">
                  {SELF_HOSTED.features.map((feature) => (
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
                {/* Same list shape, deliberately not the same marker: a dash
                    where the tiers carry a tick, so the two lines read as the
                    cost of running it yourself rather than as four extra
                    features the paid plans lack. */}
                <p className="text-foreground mt-5 text-xs font-semibold">
                  {SELF_HOSTED.burdensLabel}
                </p>
                <ul className="mt-3 space-y-2.5">
                  {SELF_HOSTED.burdens.map((burden) => (
                    <li key={burden} className="flex gap-2.5 text-sm">
                      <Minus
                        aria-hidden="true"
                        className="text-muted-foreground/60 mt-0.5 size-4 shrink-0"
                        strokeWidth={2.25}
                      />
                      <span className="text-muted-foreground leading-relaxed">
                        {burden}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>

              <CardFooter className="mt-6">
                {/* A same-page jump, so a plain anchor: next/link would push a
                    history entry for a hash the router does not own. */}
                <Button
                  className={cn("h-9 w-full", CTA_CLASS)}
                  variant="outline"
                  nativeButton={false}
                  render={<a href={`#${SELF_HOSTED.anchor}`} />}
                >
                  <span>Install it yourself</span>
                  <ArrowDown aria-hidden="true" className="size-4" />
                </Button>
              </CardFooter>
            </Card>
          </PlanTilt>

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

        {/* Notes — centred under the card row rather than hugging the left
            edge, which read as a stray column against the grid. */}
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
            always an option, you bring the infrastructure and the model
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
              {/* The whole header row stays grey: the plan names label the
                  columns, and picking one out in full contrast read as the
                  recommended-plan highlight repeating itself. */}
              {COMPARISON_COLUMNS.map((column) => (
                <div
                  key={column}
                  className="text-muted-foreground px-4 py-3.5 font-mono text-[10.5px] font-medium tracking-widest uppercase"
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
                            ·
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

        {/* Self-hosted install — the destination of the Self-hosted card's CTA.
            `scroll-mt` clears the fixed marketing header, which would otherwise
            sit on top of the heading after the jump. */}
        <section
          id={SELF_HOSTED.anchor}
          className="mt-20 scroll-mt-28 sm:scroll-mt-32"
        >
          <h2 className="text-foreground text-center text-2xl font-semibold tracking-tight">
            Install the self-hosted edition
          </h2>
          <p className="text-muted-foreground mx-auto mt-3 max-w-2xl text-center text-sm leading-relaxed">
            Clone the repository and it runs. With no database configured the
            console starts on an in-memory demo dataset, so you can click
            through the whole product before wiring anything up.
          </p>

          <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:items-start">
            <CodeBlock tabs={INSTALL_TABS} />

            <div className="border-border/70 bg-card/60 rounded-xl border p-6 backdrop-blur-sm">
              <p className="text-foreground text-sm font-semibold">
                What you provide
              </p>
              <ul className="mt-4 space-y-4">
                {INSTALL_REQUIREMENTS.map((requirement) => (
                  <li key={requirement.title}>
                    <p className="text-foreground text-sm font-medium">
                      {requirement.title}
                    </p>
                    <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
                      {requirement.detail}
                    </p>
                  </li>
                ))}
              </ul>
              <div className="mt-6 flex flex-col gap-2">
                <Button
                  className={cn("h-9 w-full", CTA_CLASS)}
                  variant="outline"
                  nativeButton={false}
                  render={
                    <a
                      href="https://docs.ciele.app/self-hosting/installation"
                      target="_blank"
                      rel="noreferrer"
                    />
                  }
                >
                  <span>Self-hosting docs</span>
                </Button>
                <Button
                  className={cn("h-9 w-full", CTA_CLASS)}
                  variant="outline"
                  nativeButton={false}
                  render={
                    <a
                      href={SOURCE_URL}
                      target="_blank"
                      rel="noreferrer"
                    />
                  }
                >
                  <span>View the source</span>
                </Button>
              </div>
              <p className="text-muted-foreground mt-4 text-xs leading-relaxed">
                AGPL-3.0. Hosting, upgrades, backups, plan billing and support
                are the managed edition&rsquo;s job, everything else is in the
                repository.
              </p>
            </div>
          </div>
        </section>

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
      "The AI work the platform funds for you: answering questions, crawling your sites and indexing your documents. Each plan states that as volumes, answers, pages, documents, and all three draw on the same monthly allowance, so a month spent indexing a large site leaves less for answering, and the other way round. Your Usage page shows the split as it happens.",
  },
  {
    id: "why-not-tokens",
    title: "Why volumes instead of tokens?",
    description:
      "Because tokens are our unit, not yours. A plan's allowance is denominated in cost, which we then restate as the volumes that cost funds, so the plan means the same thing whichever model your assistants run. A frontier model spends the allowance faster and covers proportionally fewer answers; it never quietly costs you more than the plan.",
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
      "Yes, from Business up. Connect your own Anthropic, OpenAI or Google key, or any OpenAI-compatible endpoint including a self-hosted one. Enterprise adds keyless federated access, Google Vertex, Anthropic workload identity or Azure OpenAI, so no long-lived key is ever stored with us.",
  },
  {
    id: "switch",
    title: "Can we switch plans later?",
    description:
      "Yes. Plans change from the console and take effect on the next billing period; your assistants, knowledge and history carry over untouched.",
  },
  {
    id: "self-hosted",
    title: "What is the difference between self-hosted and a paid plan?",
    description:
      "The product is the same, self-hosting gives you the whole open-source core under the AGPL. What a paid plan adds is that we operate it: hosting, upgrades and backups, a monthly AI allowance on our provider accounts instead of yours, plan billing and usage controls, and support. Self-hosted, all of that is your side of the line.",
  },
  {
    id: "education",
    title: "Do you offer education or non-profit pricing?",
    description:
      "We do. Ciele is built for institutions, and we quote academic and non-profit rollouts case by case, get in touch and we will work it out with you.",
  },
];
