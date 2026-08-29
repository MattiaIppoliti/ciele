import type { Metadata } from "next";
import { FeaturesSection, HeroSection } from "@/components/home/hero-section";
import { HomeSectionRail } from "@/components/home/home-section-rail";
import { CloudCallout } from "@/components/marketing/cloud-callout";
import { CtaSection } from "@/components/marketing/cta-section";
import { GroupCoda } from "@/components/marketing/group-coda";

export const metadata: Metadata = {
  title: "Ciele, AI assistants for your business",
  description:
    "Build, test and publish AI assistants that answer from your organization's own knowledge.",
};

export default function HomePage() {
  return (
    <>
      <HomeSectionRail />
      <main>
        <HeroSection />
        <FeaturesSection />
        {/* The Teammates group thread turns the feature grid into a concrete
            piece of product before the closing callout. The same CTA sign-off
            every marketing page uses still hands the home over to the footer,
            rather than letting the demo become an abrupt final screen. */}
        <section className="home-below-fold bg-background">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-8 lg:px-12">
            <div className="pt-20 sm:pt-28">
              <GroupCoda />
            </div>
            <CloudCallout
              className="mt-16 sm:mt-24"
              expression="neutral"
              eyebrow="Meet your teammate"
              title="The right teammate, in the right conversation"
              body="Mention the teammates you need in a shared channel. Each brings its own knowledge and tools, while your people keep the context and make the call."
              cta={{ label: "Meet Ciele Teammates", href: "/features/teammates" }}
            />
          </div>
          <CtaSection
            lead="Built on your knowledge."
            trail="Answering today."
            primary={{ label: "Request a demo", href: "/contact/sales" }}
            secondary={{ label: "Log in", href: "/login" }}
          />
        </section>
      </main>
    </>
  );
}
