import Link from "next/link";
import { ArrowDown, ArrowRight, Check, Minus } from "lucide-react";
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
import {
  BouncyAccordion,
  type BouncyAccordionItem,
} from "@/components/motion/bouncy-accordion";
import { CloudCallout } from "@/components/marketing/cloud-callout";
import { GridBeam } from "@/components/motion/grid-beam";
import { MarketingHero } from "@/components/marketing/marketing-hero";
import { CodeBlock } from "@/components/ui/code-block";
import { CTA_CLASS, ENTERPRISE, PlanTilt } from "./plan-cards";

/**
 * The public pricing page.
 *
 * Entirely a server component: Ciele is offered exactly two ways, run the
 * open-source core yourself for free, or have us run it for you on Enterprise
 * terms, and neither offering carries a published price, a checkout button or
 * a usage picker. With nothing interactive left, every section here, the hero,
 * the two cards, the comparison grid, the install section and the FAQ, is
 * static copy, and none of it needs to be shipped to the browser as JavaScript
 * to be hydrated.
 *
 * The Enterprise copy and the shared card chrome live in `./plan-cards`.
 */

/**
 * The free offering, and deliberately not a purchasable tier: it has no price
 * and no included allowance, and its CTA leads to the install section further
 * down this page rather than to sales.
 *
 * Its feature lines are the open-source core as documented in
 * `apps/docs/content/docs/self-hosting/open-core-boundary.mdx`: the whole
 * product minus what the mirror gate strips (billing, plan metering, the staff
 * console, managed SSO onboarding, and anything with a service commitment).
 *
 * Ticks and burdens are two fields on purpose: a tick reads as "included", and
 * the free column collecting as many of them as the offering beside it argues
 * against that offering. So the ticks stop at the capabilities, and what the
 * self-hoster takes on renders below them as a burden, not as a benefit.
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

const COMPARISON_COLUMNS = [SELF_HOSTED.name, ENTERPRISE.name] as const;

/**
 * Feature matrix, in the column order above. The self-hosted column is the
 * AGPL mirror: it carries the whole open-source product but none of the paths
 * the mirror strips (`scripts/mirror-gate` EE_PATHS), no billing, no plan
 * metering, no managed SSO onboarding, no staff console, and it has no
 * platform-funded models, so its own provider keys are mandatory rather than
 * optional.
 *
 * Its cells therefore say what the self-hoster PROVIDES, never a bare check.
 * A tick reads as "included", and on this column the same capability is work
 * the reader takes on, a matrix where the free column collects more ticks than
 * the offering beside it is not generous, it is wrong, and it argues against
 * that offering.
 */
const COMPARISON_ROWS: Array<{ label: string; cells: ComparisonCell[] }> = [
  { label: "Monthly price", cells: ["Free", "Sized with you"] },
  { label: "Licence and terms", cells: ["AGPL-3.0", "Commercial agreement"] },
  {
    label: "Hosting, updates and backups",
    cells: ["You run it", "Managed"],
  },
  {
    label: "Included AI usage",
    cells: ["Your own bill", "A monthly allowance, sized with you"],
  },
  { label: "Model credentials included", cells: [false, true] },
  { label: "Unlimited assistants and flows", cells: [true, true] },
  { label: "Website, file and FAQ knowledge", cells: [true, true] },
  { label: "Grounded answers with citations", cells: [true, true] },
  { label: "Inbox, insights and improvements", cells: [true, true] },
  { label: "Help desks and escalation", cells: [true, true] },
  {
    label: "Bring your own model keys",
    cells: ["Required", "Optional"],
  },
  {
    label: "Keyless federated model access",
    cells: ["Your own cloud setup", true],
  },
  {
    label: "Crawl JavaScript-heavy and gated sites",
    cells: ["You host the crawler", true],
  },
  {
    label: "Ticketing integrations",
    cells: ["You configure it", true],
  },
  {
    label: "Usage caps and budget controls",
    cells: [false, true],
  },
  { label: "Managed SSO onboarding", cells: [false, true] },
  { label: "DPA, SCCs and security review", cells: [false, true] },
  { label: "Support", cells: ["Community", "Named contact"] },
  { label: "Uptime and response commitment", cells: [false, true] },
];

/**
 * The open-source repository, where "View the source" goes and what the quick
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
 * change here too, a pricing page that promises a broken quick start is worse
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

/**
 * The free edition's card. The two cards share their vertical rhythm, the
 * same tagline floor and price row, so their feature lists start at the same
 * height and read as a comparison.
 */
function SelfHostedCard() {
  return (
    <PlanTilt>
      <Card className="bg-card/60 h-full gap-0 backdrop-blur-sm [--card-spacing:--spacing(6)]">
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle className="text-foreground text-lg font-semibold">
              {SELF_HOSTED.name}
            </CardTitle>
            <Badge variant="outline">Open source</Badge>
          </div>
          {/* Two-line floor on the tagline: the two cards then reach their
              price row at the same y, which is what makes them comparable.
              See the same class on the Enterprise card. */}
          <p className="text-muted-foreground mt-1 min-h-17 text-sm leading-relaxed">
            {SELF_HOSTED.tagline}
          </p>
          {/* No price data anywhere on this page: this edition's price is the
              licence, and the other offering's price is a conversation. */}
          <div className="mt-6 flex items-baseline gap-1.5">
            <span className="text-foreground text-4xl font-semibold">Free</span>
            <span className="text-muted-foreground text-sm">/ forever</span>
          </div>
          <p className="text-muted-foreground mt-1.5 min-h-8 text-xs">
            AGPL-3.0, with no plan and no allowance. The AI work goes on your
            own provider account, or runs on a model server you host.
          </p>
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
              where the features carry a tick, so the two lines read as the
              cost of running it yourself rather than as extra features the
              managed offering lacks. */}
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
  );
}

/**
 * The managed offering's card. Sales-led, always: its price line is the
 * conversation, and its CTA goes to sales rather than to a checkout that
 * cannot size a rollout.
 */
function EnterpriseCard() {
  return (
    <PlanTilt>
      <Card className="bg-card/60 h-full gap-0 backdrop-blur-sm [--card-spacing:--spacing(6)]">
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle className="text-foreground text-lg font-semibold">
              {ENTERPRISE.name}
            </CardTitle>
            <Badge variant="outline">Managed</Badge>
          </div>
          <p className="text-muted-foreground mt-1 min-h-17 text-sm leading-relaxed">
            {ENTERPRISE.tagline}
          </p>
          <div className="mt-6 flex items-baseline gap-1.5">
            <span className="text-foreground text-4xl font-semibold">
              Let&rsquo;s talk
            </span>
          </div>
          <p className="text-muted-foreground mt-1.5 min-h-8 text-xs">
            Priced to your rollout, once we have sized it with you. Unlimited
            members, and a monthly AI allowance written into the agreement.
          </p>
        </CardHeader>

        <CardContent className="mt-6 flex-1">
          <p className="text-foreground text-xs font-semibold">
            {ENTERPRISE.featuresLabel}
          </p>
          <ul className="mt-3 space-y-2.5">
            {ENTERPRISE.features.map((feature) => (
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
          <Button
            className={cn("h-9 w-full", CTA_CLASS)}
            variant="outline"
            nativeButton={false}
            render={<Link href="/contact/sales" />}
          >
            <span>{ENTERPRISE.salesCta}</span>
            <ArrowRight aria-hidden="true" className="size-4" />
          </Button>
        </CardFooter>
      </Card>
    </PlanTilt>
  );
}

export function PricingContent() {
  return (
    <main className="relative px-4 pb-8 pt-28 sm:px-8 sm:pt-36 lg:px-12">
      <div className="mx-auto w-full max-w-6xl">
        {/* Hero */}
        <MarketingHero eyebrow="Pricing" title="Two ways to run Ciele">
          <p className="text-muted-foreground mt-6 text-lg leading-relaxed">
            Both include the whole product: assistants, knowledge, flows, inbox
            and insights, for as many members as you like. Run the open-source
            core yourself for free, or let us run it for you on Enterprise
            terms, sized to your rollout in a conversation with sales.
          </p>
        </MarketingHero>

        {/* The two offerings. A two-card grid, centred and narrower than the
            page: at full width two cards read as a broken four-card row. */}
        <div className="mx-auto mt-12 grid max-w-4xl gap-5 sm:grid-cols-2">
          <SelfHostedCard />
          <EnterpriseCard />
        </div>

        {/* Centred under the card row rather than hugging the left edge,
            which read as a stray column against the grid. */}
        <div className="mx-auto mt-12 max-w-3xl text-center">
          <p className="text-sm leading-relaxed">
            <span className="text-muted-foreground">
              A multi-campus rollout, procurement requirements, or education and
              non-profit rates?{" "}
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
            Compare the two editions
          </h2>
          <p className="text-muted-foreground mx-auto mt-3 max-w-2xl text-center text-sm leading-relaxed">
            Ciele is open source under the AGPL, so running it yourself is
            always an option. You bring the infrastructure and the model
            account, and you keep the whole product.
          </p>

          {/* Three columns still will not fit a small phone; scroll the grid
              inside its own container rather than letting the page scroll
              sideways. */}
          <div className="mt-8 overflow-x-auto">
            <GridBeam
              className="border-border/70 mx-auto min-w-[560px] max-w-4xl overflow-hidden rounded-2xl border"
              cols={COMPARISON_COLUMNS.length + 1}
              columnsTemplate="minmax(0, 1.4fr) repeat(2, minmax(0, 1fr))"
              rows={COMPARISON_ROWS.length + 1}
            >
              {/* Header row: an empty corner cell, then the two editions. */}
              <div className="px-4 py-3.5" />
              {/* The whole header row stays grey: the names label the columns,
                  and picking one out in full contrast would read as a
                  recommendation this page deliberately does not make. */}
              {COMPARISON_COLUMNS.map((column) => (
                <div
                  key={column}
                  className="text-muted-foreground px-4 py-3.5 font-mono text-[10.5px] font-medium tracking-widest uppercase"
                >
                  {column}
                </div>
              ))}

              {COMPARISON_ROWS.map((row) => (
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

        {/* Self-hosted install, the destination of the Self-hosted card's CTA.
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
                    <a href={SOURCE_URL} target="_blank" rel="noreferrer" />
                  }
                >
                  <span>View the source</span>
                </Button>
              </div>
              <p className="text-muted-foreground mt-4 text-xs leading-relaxed">
                AGPL-3.0. Hosting, upgrades, backups, usage controls and support
                are the Enterprise edition&rsquo;s job, everything else is in
                the repository.
              </p>
            </div>
          </div>
        </section>

        {/* FAQ, the block is centred, but each row stays left-aligned: a
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

        <CloudCallout
          expression="attentive"
          eyebrow="All ears"
          title="Listening before it quotes"
          body="Start self-hosted for free, or talk to us about a managed rollout sized to what you actually need, either way you keep your data and your terms."
          cta={{ label: "Talk to sales", href: "/contact/sales" }}
        />
      </div>
    </main>
  );
}

const FAQ_ITEMS: BouncyAccordionItem[] = [
  {
    id: "difference",
    title: "What is the difference between self-hosted and Enterprise?",
    description:
      "The product is the same, self-hosting gives you the whole open-source core under the AGPL. What Enterprise adds is that we operate it: hosting, upgrades and backups, a monthly AI allowance on our provider accounts instead of yours, usage caps and budget controls, managed SSO onboarding, contractual commitments and support. Self-hosted, all of that is your side of the line.",
  },
  {
    id: "enterprise-price",
    title: "How is Enterprise priced?",
    description:
      "In a conversation, not on a card. Tell us the size of your rollout: how many people it serves, what it needs to plug into, roughly how much answering you expect. We quote a monthly price with the AI allowance written into the agreement. Members are unlimited whatever the size.",
  },
  {
    id: "allowance",
    title: "What does an Enterprise allowance cover?",
    description:
      "The AI work the platform funds for you: answering questions, crawling your sites and indexing your documents. All three draw on the same monthly allowance, sized with you and stated in the agreement, and your Usage page shows exactly where you are against it. Work on your own model keys is never counted against it.",
  },
  {
    id: "visitors",
    title: "Do members or chat visitors cost extra?",
    description:
      "Neither, in either edition. Members with console access are unlimited, and people chatting with a published widget are never counted or charged. Enterprise meters the AI work, not the people, and self-hosted meters nothing at all.",
  },
  {
    id: "byok",
    title: "Can we bring our own models?",
    description:
      "Yes, in both editions. Self-hosted runs entirely on your own keys: any supported provider, or an OpenAI-compatible endpoint including a local one. Enterprise includes an allowance on our accounts and lets you connect your own keys on top, or use keyless federated access through Google Vertex, Anthropic workload identity or Azure OpenAI, so no long-lived key is ever stored with us.",
  },
  {
    id: "migrate",
    title: "Can we start self-hosted and move to Enterprise later?",
    description:
      "Yes, in both directions. It is one codebase and one schema, so your assistants, knowledge and history move with the database. Plenty of teams evaluate self-hosted and switch to Enterprise when the rollout gets serious, and the AGPL means you can always take it back in-house.",
  },
  {
    id: "education",
    title: "Do you offer education or non-profit pricing?",
    description:
      "We do. We quote academic and non-profit rollouts case by case. Get in touch and we will work it out with you.",
  },
];
