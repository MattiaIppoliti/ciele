import { Check, Server, Sparkles } from "lucide-react";
import { Link } from "@/components/ui/link";

/**
 * Public pricing (#444, decision #427).
 *
 * Two deliberate properties, both from the spec:
 *
 *  1. **No hard prices.** Plan tiers are listed and differentiated, but the
 *     numbers wait until real metering cost data exists. Every managed path
 *     ends in a conversation, because evaluation is sales-led.
 *  2. **Self-hosting is prominent, not buried.** It is the free tier, so it
 *     gets equal visual weight at the top rather than a footnote.
 */

interface Tier {
  name: string;
  audience: string;
  highlights: string[];
}

const TIERS: Tier[] = [
  {
    name: "Starter",
    audience: "One team getting its first assistants in front of people.",
    highlights: [
      "Included AI usage for everyday volumes",
      "All product features — flows, knowledge, help desks, insights",
      "Email support",
    ],
  },
  {
    name: "Pro",
    audience: "Several teams running assistants across different audiences.",
    highlights: [
      "Higher included AI usage",
      "More seats and assistants",
      "Priority support",
    ],
  },
  {
    name: "Enterprise",
    audience: "Institution-wide rollouts with procurement and security review.",
    highlights: [
      "Usage sized to your deployment",
      "Security review, DPA, and custom terms",
      "Named contact and onboarding support",
    ],
  },
];

export function PricingContent() {
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
              AGPL-3.0, forever. You provide the machine and the models.
            </p>
            <ul className="mt-6 space-y-3 text-sm">
              {[
                "The whole product — nothing held back",
                "One command to install with Docker",
                "Any OpenAI-compatible model, including fully local",
                "Your data never leaves your infrastructure",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2.5">
                  <Check className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                  <span className="text-muted-foreground">{item}</span>
                </li>
              ))}
            </ul>
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
              Let&apos;s talk
            </p>
            <p className="text-muted-foreground mt-2 text-sm">
              Priced to your usage. We set the organization up with you.
            </p>
            <ul className="mt-6 space-y-3 text-sm">
              {[
                "Model credentials included — nothing to configure",
                "We run the infrastructure, upgrades and backups",
                "Usage visible in-product against your plan",
                "Support from the people who build it",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2.5">
                  <Check className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                  <span className="text-muted-foreground">{item}</span>
                </li>
              ))}
            </ul>
            <Link
              href="/contact/sales"
              className="bg-primary text-primary-foreground hover:bg-primary/85 mt-8 inline-flex w-full items-center justify-center rounded-lg px-4 py-2.5 text-sm font-medium transition-colors"
            >
              Talk to us
            </Link>
          </section>
        </div>

        {/* Cloud plan tiers — named and differentiated, deliberately unpriced. */}
        <section className="mt-20">
          <h2 className="text-foreground text-2xl font-semibold tracking-tight">
            Ciele Cloud plans
          </h2>
          <p className="text-muted-foreground mt-3 max-w-2xl text-sm leading-relaxed">
            Plans differ by included AI usage, seats, and support. We would
            rather size one with you than publish a number that turns out to be
            wrong for your deployment.
          </p>
          <div className="mt-8 grid gap-6 md:grid-cols-3">
            {TIERS.map((tier) => (
              <div
                key={tier.name}
                className="border-border bg-background/50 rounded-2xl border p-6 backdrop-blur-sm"
              >
                <h3 className="text-foreground text-lg font-semibold">
                  {tier.name}
                </h3>
                <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                  {tier.audience}
                </p>
                <ul className="mt-5 space-y-2.5 text-sm">
                  {tier.highlights.map((item) => (
                    <li key={item} className="flex items-start gap-2.5">
                      <Check className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                      <span className="text-muted-foreground">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <section className="border-border mt-20 rounded-2xl border p-8">
          <h2 className="text-foreground text-xl font-semibold">
            How getting started works
          </h2>
          <ol className="text-muted-foreground mt-5 space-y-4 text-sm leading-relaxed">
            <li>
              <span className="text-foreground font-medium">1. Sign up.</span>{" "}
              You can build assistants, add knowledge and invite your team
              immediately. Assistants start answering once we activate your
              organization.
            </li>
            <li>
              <span className="text-foreground font-medium">
                2. Talk to us.
              </span>{" "}
              We learn what you are building, size a plan, and switch you on
              with evaluation limits so you can try it properly.
            </li>
            <li>
              <span className="text-foreground font-medium">
                3. Convert when it is working.
              </span>{" "}
              When the evaluation has done its job, your billing page carries a
              checkout link for the plan we agreed.
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
