import { Check, Server, Sparkles } from "lucide-react";
import { Link } from "@/components/ui/link";
import type { PlanCatalog } from "@agent-hub/agent";
import { planTierViews } from "@/lib/plan-pricing";

/**
 * Public pricing (#444 / #511, decisions #427 and #424).
 *
 * Three deliberate properties:
 *
 *  1. **Real prices.** The original page listed tiers without numbers because
 *     metering cost data did not exist yet (#444). It does now, so each tier
 *     shows its monthly price and its allowance restated as volumes — answers,
 *     crawled pages, indexed documents — derived from the same constants the caps
 *     enforce. The top tier stays sales-led and reads "from", because a sized
 *     deployment is a conversation.
 *  2. **Self-hosting keeps equal weight.** It is the free, uncapped path and sits
 *     side by side with the managed one, not in a footnote.
 *  3. **A deployment with nothing to sell shows nothing to sell.** The plan
 *     ladder comes from the enterprise capability seam; with no catalog (the
 *     open-source edition) the page is the self-host story plus a way to reach us,
 *     which is exactly true there.
 */

const SELF_HOST_POINTS = [
  "The whole product — nothing held back",
  "One command to install with Docker",
  "Any OpenAI-compatible model, including fully local",
  "Your data never leaves your infrastructure",
];

const CLOUD_POINTS = [
  "Model credentials included — nothing to configure",
  "We run the infrastructure, upgrades and backups",
  "Usage visible in-product against your plan",
  "Support from the people who build it",
];

function Points({ items }: { items: readonly string[] }) {
  return (
    <ul className="mt-6 space-y-3 text-sm">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2.5">
          <Check className="mt-0.5 size-4 shrink-0 text-emerald-500" />
          <span className="text-muted-foreground">{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function PricingContent({
  catalog,
}: {
  /** The purchasable tiers, or null on a deployment that sells nothing. */
  catalog: PlanCatalog | null;
}) {
  const tiers = planTierViews(catalog?.tiers ?? null);
  const entry = tiers[0] ?? null;
  const basis = catalog?.answerBasis ?? null;

  return (
    <main className="relative px-4 pb-24 pt-28 sm:px-8 sm:pt-36 lg:px-12">
      <div className="mx-auto w-full max-w-6xl">
        <div className="max-w-3xl">
          <p className="text-muted-foreground font-mono text-xs font-medium uppercase tracking-wider">
            Pricing
          </p>
          <h1 className="text-foreground mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
            Run it yourself, or let us run it
          </h1>
          <p className="text-muted-foreground mt-6 text-lg leading-relaxed">
            Ciele is open source. Self-hosting is free and always will be — the
            same complete product, on your own infrastructure. Ciele Cloud is
            for organizations that would rather not operate it, and it includes
            the model credentials so there is nothing to configure.
          </p>
        </div>

        {/* The two ways to get Ciele, equally weighted. */}
        <div className="mt-14 grid gap-6 md:grid-cols-2">
          <section className="border-border bg-background/50 rounded-2xl border p-8 backdrop-blur-sm">
            <div className="flex items-center gap-2">
              <Server className="text-muted-foreground size-5" />
              <h2 className="text-foreground text-xl font-semibold">
                Self-hosted
              </h2>
            </div>
            <p className="text-foreground mt-4 text-3xl font-semibold tracking-tight">
              Free
            </p>
            <p className="text-muted-foreground mt-2 text-sm">
              AGPL-3.0, forever. You provide the machine and the models, and
              nothing is capped.
            </p>
            <Points items={SELF_HOST_POINTS} />
            <a
              href="https://ciele.app/docs/self-hosting"
              className="border-border hover:bg-muted mt-8 inline-flex w-full items-center justify-center rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors"
            >
              Read the self-hosting guide
            </a>
          </section>

          <section className="border-foreground/20 bg-background/50 rounded-2xl border p-8 backdrop-blur-sm">
            <div className="flex items-center gap-2">
              <Sparkles className="text-muted-foreground size-5" />
              <h2 className="text-foreground text-xl font-semibold">
                Ciele Cloud
              </h2>
            </div>
            <p className="text-foreground mt-4 text-3xl font-semibold tracking-tight">
              {entry ? (
                <>
                  {entry.priceLabel}
                  <span className="text-muted-foreground text-base font-normal">
                    {" "}
                    / month and up
                  </span>
                </>
              ) : (
                "Let’s talk"
              )}
            </p>
            <p className="text-muted-foreground mt-2 text-sm">
              {entry
                ? // Not "three plans": the ladder is data, and a fourth tier
                  // would make a counted noun wrong. Not "cancel any time"
                  // either — cancellation is Stripe's billing portal, which is
                  // where the copy on your billing page points.
                  "Monthly, each plan with an included usage allowance. You manage it yourself in the billing portal."
                : "Priced to your usage. We set the organization up with you."}
            </p>
            <Points items={CLOUD_POINTS} />
            <Link
              href={entry ? "/signup" : "/contact/sales"}
              className="bg-primary text-primary-foreground hover:bg-primary/85 mt-8 inline-flex w-full items-center justify-center rounded-lg px-4 py-2.5 text-sm font-medium transition-colors"
            >
              {entry ? "Get started" : "Talk to us"}
            </Link>
          </section>
        </div>

        {tiers.length > 0 && (
          <section className="mt-20">
            <h2 className="text-foreground text-2xl font-semibold tracking-tight">
              Ciele Cloud plans
            </h2>
            <p className="text-muted-foreground mt-3 max-w-2xl text-sm leading-relaxed">
              Every plan is the whole product — flows, knowledge, help desks,
              inbox and insights. They differ by how much platform-funded work
              they include each month.
            </p>
            <div className="mt-8 grid gap-6 md:grid-cols-3">
              {tiers.map((tier) => (
                <div
                  key={tier.slug}
                  className="border-border bg-background/50 flex flex-col rounded-2xl border p-6 backdrop-blur-sm"
                >
                  <h3 className="text-foreground text-lg font-semibold">
                    {tier.name}
                  </h3>
                  <p className="mt-3">
                    {tier.pricePrefix && (
                      <span className="text-muted-foreground text-sm">
                        {tier.pricePrefix}{" "}
                      </span>
                    )}
                    <span className="text-foreground text-3xl font-semibold tracking-tight">
                      {tier.priceLabel}
                    </span>
                    <span className="text-muted-foreground text-sm">
                      {" "}
                      / month
                    </span>
                  </p>
                  {tier.audience && (
                    <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
                      {tier.audience}
                    </p>
                  )}
                  <ul className="mt-5 space-y-2.5 text-sm">
                    {tier.volumes.map((line) => (
                      <li key={line} className="flex items-start gap-2.5">
                        <Check className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                        <span className="text-muted-foreground">{line}</span>
                      </li>
                    ))}
                  </ul>
                  {/* Sales-led vs self-serve is a property of the TIER, so this
                      branches on that rather than on whether checkout is wired:
                      the visitor signs up either way, and buying happens on
                      their billing page. */}
                  <Link
                    href={tier.salesLed ? "/contact/sales" : "/signup"}
                    className="border-border hover:bg-muted mt-6 inline-flex w-full items-center justify-center rounded-lg border px-4 py-2 text-sm font-medium transition-colors"
                  >
                    {tier.salesLed ? "Talk to us" : `Start with ${tier.name}`}
                  </Link>
                </div>
              ))}
            </div>

            <div className="text-muted-foreground mt-8 space-y-3 text-sm leading-relaxed">
              <p>
                Every volume is what the allowance funds, rounded down. A crawled
                page is priced at our metered crawler&apos;s rate and a document
                is about 1,500 words, so both are floors — most deployments get
                more.
              </p>
              {basis ? (
                <p>
                  Answers are quoted on{" "}
                  <span className="text-foreground font-medium">
                    {basis.quotedModel}
                  </span>
                  , the lightest model on the platform. Which model your
                  assistants run is your choice and it changes this number a lot:
                  on {basis.frontierModel} — what a new assistant starts with —
                  one answer costs roughly {basis.frontierFactor}× more, so the
                  same allowance covers proportionally fewer. Your Usage page
                  shows exactly where you are, and each allowance is also capped
                  per week so a busy few days cannot spend the month.
                </p>
              ) : null}
              <p>
                <span className="text-foreground font-medium">
                  Using your own model keys?
                </span>{" "}
                That traffic is yours end to end — it is never counted against a
                plan allowance and never blocked by one. Plans meter only the work
                the platform funds.
              </p>
            </div>
          </section>
        )}

        <section className="border-border mt-20 rounded-2xl border p-8">
          <h2 className="text-foreground text-xl font-semibold">
            How getting started works
          </h2>
          <ol className="text-muted-foreground mt-5 space-y-4 text-sm leading-relaxed">
            <li>
              <span className="text-foreground font-medium">1. Sign up.</span>{" "}
              You can build assistants, add knowledge and invite your team
              immediately. Assistants start answering once your organization is
              activated.
            </li>
            <li>
              <span className="text-foreground font-medium">
                2. Try it properly.
              </span>{" "}
              We switch you on with evaluation limits so you can see it working
              against your own content, and help you size a plan if you want the
              conversation.
            </li>
            <li>
              <span className="text-foreground font-medium">
                3. Pick a plan when it is working.
              </span>{" "}
              {entry
                ? "Your billing page carries the plans and their meters — subscribe there, and change or cancel later in the billing portal."
                : "Your billing page carries a checkout link for the plan we agreed."}
            </li>
          </ol>
          <p className="text-muted-foreground mt-6 text-sm">
            In a hurry, or would rather not talk to anyone?{" "}
            <a
              href="https://ciele.app/docs/self-hosting"
              className="text-foreground font-medium underline underline-offset-4"
            >
              Self-host it today
            </a>{" "}
            — it is the same product, free.
          </p>
        </section>
      </div>
    </main>
  );
}
