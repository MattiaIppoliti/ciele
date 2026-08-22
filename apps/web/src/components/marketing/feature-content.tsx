import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Magnetic } from "@/components/core/magnetic";
import { CloudCallout } from "@/components/marketing/cloud-callout";
import { CtaSection } from "@/components/marketing/cta-section";
import { FEATURES, type FeatureEntry } from "@/components/marketing/feature-catalog";
import { FeaturePoints } from "@/components/marketing/feature-points";
import { FeatureWindow } from "@/components/marketing/feature-window";
import { KanbanMock } from "@/components/marketing/feature-mocks";
import { MarketingHero } from "@/components/marketing/marketing-hero";
import { PreviewCoda } from "@/components/marketing/preview-coda";

/* A feature page is one claim, one picture of the screen that backs it, and
   three supporting points, in that order, so a visitor can stop reading as
   soon as they have what they came for. */
export function FeatureContent({ feature }: { feature: FeatureEntry }) {
  const others = FEATURES.filter((entry) => entry.slug !== feature.slug);

  return (
    <main className="relative px-4 pb-8 pt-28 sm:px-8 sm:pt-36 lg:px-12">
      <div className="mx-auto w-full max-w-6xl">
        <MarketingHero
          className="max-w-2xl"
          eyebrow={feature.eyebrow}
          title={feature.headline}
        >
          <p className="text-muted-foreground mt-5 text-lg leading-relaxed">
            {feature.standfirst}
          </p>
        </MarketingHero>

        <div className="mt-14">
          <FeatureWindow shot={feature.shot} label={feature.label} />
        </div>

        <div className="mt-14">
          <FeaturePoints feature={feature} />
        </div>

        {/* The coda gets no shell round its picture: the kanban dissolves at
            its own edges, and the widget preview already is a bordered card,
            the one the product draws. */}
        {feature.coda && (
          <section className="mt-24 overflow-hidden">
            {/* Title on the left, the sentence that qualifies it on the right,
                the picture centred underneath. Same shape as the section
                headers on the Enterprise page. */}
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between lg:gap-12">
              <div className="max-w-xl">
                <p className="text-muted-foreground font-mono text-xs font-medium uppercase tracking-wider">
                  {feature.coda.eyebrow}
                </p>
                <h2 className="text-foreground mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
                  {feature.coda.headline}
                </h2>
              </div>
              <p className="text-muted-foreground max-w-md text-base leading-relaxed">
                {feature.coda.body}
              </p>
            </div>
            <div className="mt-12">
              {feature.coda.mock === "preview" ? <PreviewCoda /> : <KanbanMock />}
            </div>
          </section>
        )}

        <CloudCallout
          expression="curious"
          eyebrow="Always exploring"
          title="Curious about everything you know"
          body="Point it at your websites, documents and FAQs. It keeps digging until it can answer with a citation, and says so when it can't."
          cta={{ label: "Try it on your knowledge", href: "/contact/sales" }}
        />

        {/* The rest of the product, then the sign-off. This sits below the
            mascot band on purpose: the cloud closes the feature's own pitch,
            and a reader who is still browsing gets the other nine features
            after it, with the call to action last rather than mid-page. */}
        <nav aria-label="Other features" className="mt-24 border-t pt-10">
          <h2 className="text-muted-foreground font-mono text-xs font-medium uppercase tracking-wider">
            Keep looking
          </h2>
          <ul className="mt-6 grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            {others.map((entry) => (
              <li key={entry.slug}>
                {/* The same pull the nav's CTA has: the row leans towards the
                    cursor before you reach it, and the name underlines so the
                    thing being offered is unmistakably a link. */}
                <Magnetic range={44} intensity={0.12} maxOffset={6}>
                  <Link
                    href={`/features/${entry.slug}`}
                    className="group text-muted-foreground hover:text-foreground flex items-baseline gap-2 py-1 duration-150"
                  >
                    <span className="font-medium underline-offset-4 group-hover:underline">
                      {entry.label}
                    </span>
                    <span className="truncate text-sm">{entry.eyebrow}</span>
                    <ArrowRight className="ml-auto size-3.5 shrink-0 -translate-x-1 opacity-0 duration-200 group-hover:translate-x-0 group-hover:opacity-100" />
                  </Link>
                </Magnetic>
              </li>
            ))}
          </ul>
        </nav>

        <CtaSection
          lead="Built on your knowledge."
          trail="Answering today."
          primary={{ label: "Request a demo", href: "/contact/sales" }}
          secondary={{ label: "See pricing", href: "/pricing" }}
        />
      </div>
    </main>
  );
}
