import { Clock, PhoneCall, type LucideIcon } from "lucide-react";
import { ContactSalesForm } from "@/components/contact/contact-sales-form";
import { CloudCallout } from "@/components/marketing/cloud-callout";
import { MarketingHero } from "@/components/marketing/marketing-hero";

/**
 * The contact-sales page content, rendered inside the shared marketing shell
 * (header, sky, footer come from the (marketing) layout).
 *
 * Built from the same parts as Pricing, Security and Enterprise: the house
 * `<main>` padding on a `max-w-6xl` column, a `MarketingHero` on top, a
 * translucent `bg-card/60` panel over the sky, and the mascot callout to sign
 * off. It used to force `dark` tokens on an opaque `#080808` frame, which was
 * a black slab on a day-sky page for anyone in light mode; every surface here
 * now resolves through the theme tokens instead.
 *
 * A server component. Everything except the form itself is static copy, so the
 * only thing shipped to the browser is `ContactSalesForm`.
 */

/** The two reasons to send the form, in the order sales works them. */
const PITCH: Array<{ icon: LucideIcon; title: string; body: string }> = [
  {
    icon: PhoneCall,
    title: "Get a custom demo",
    body: "Discover the value of Ciele for your organization and explore our custom plans and pricing.",
  },
  {
    icon: Clock,
    title: "Set up your pilot",
    body: "See for yourself how Ciele's AI assistants speed up customer support and lighten the load on your teams.",
  },
];

/** What the assistant does, said twice and briefly, along the panel's foot. */
const CLAIMS: Array<{ lead: string; rest: string }> = [
  { lead: "Instant answers", rest: "from your websites, docs and files." },
  {
    lead: "24/7 support",
    rest: "on every customer channel, with human escalation.",
  },
];

/**
 * The square-grid band above and below the panel. The line colour is a custom
 * property rather than a baked rgba so it can flip with the theme: ink on the
 * light panel, white on the dark one.
 */
function GridStrip() {
  return (
    <div
      aria-hidden="true"
      className="h-16 w-full [--grid-line:rgba(0,0,0,0.07)] dark:[--grid-line:rgba(255,255,255,0.07)]"
      style={{
        backgroundImage:
          "linear-gradient(to right, var(--grid-line) 1px, transparent 1px), linear-gradient(to bottom, var(--grid-line) 1px, transparent 1px)",
        backgroundSize: "64px 64px",
        // Start each strip at its frame edge. Centering a 64px pattern was
        // producing half-width cells at both sides of the perimeter.
        backgroundPosition: "left top",
      }}
    />
  );
}

export function ContactSales() {
  return (
    <main className="relative px-4 pb-8 pt-28 sm:px-8 sm:pt-36 lg:px-12">
      <div className="relative z-10 mx-auto w-full max-w-6xl">
        <MarketingHero eyebrow="Contact sales" title="Learn about Ciele">
          <p className="text-muted-foreground mt-6 text-lg leading-relaxed">
            Talk to the people who build Ciele. Tell us what you want your
            assistant to handle and we will come back with a time, usually
            within one working day.
          </p>
        </MarketingHero>

        {/* overflow-hidden is what lets the grid bands run to the rounded
            corners instead of squaring them off. */}
        <div className="border-border bg-card/60 mt-14 overflow-hidden rounded-3xl border backdrop-blur-sm">
          <GridStrip />

          <div className="border-border grid border-y md:grid-cols-2">
            {/* Pitch column */}
            <div className="border-border flex flex-col md:border-r">
              <div className="space-y-8 p-8 md:p-10">
                {PITCH.map((point) => (
                  <div key={point.title}>
                    {/* The same muted tile the feature and security grids put
                        their icons in, so this page's icons are not a third
                        treatment. */}
                    <span className="bg-muted mb-4 flex size-9 items-center justify-center rounded-lg border">
                      <point.icon
                        className="text-muted-foreground size-4"
                        strokeWidth={1.75}
                      />
                    </span>
                    {/* font-sans: the marketing layout sets headings in the
                        serif display face, which argues with the body copy at
                        this size. */}
                    <h2 className="text-foreground font-sans text-base font-medium">
                      {point.title}
                    </h2>
                    <p className="text-muted-foreground mt-2 leading-relaxed">
                      {point.body}
                    </p>
                  </div>
                ))}
              </div>

              {/* mt-auto pins the claims to the foot of the column, which on a
                  wide screen is the foot of the form beside it. */}
              <div className="border-border divide-border mt-auto grid divide-y border-t sm:grid-cols-2 sm:divide-x sm:divide-y-0">
                {CLAIMS.map((claim) => (
                  <p key={claim.lead} className="p-8 text-lg leading-snug">
                    <span className="font-semibold">{claim.lead}</span>{" "}
                    <span className="text-muted-foreground">{claim.rest}</span>
                  </p>
                ))}
              </div>
            </div>

            {/* Form column */}
            <div className="p-8 md:p-10">
              <ContactSalesForm />
            </div>
          </div>

          <GridStrip />
        </div>

        <CloudCallout
          expression="laughing"
          eyebrow="Say hello"
          title="It's a good conversation"
          body="Tell us what you're building and we'll show you what your assistant could answer on day one: real questions, your knowledge, no slideware."
        />
      </div>
    </main>
  );
}
