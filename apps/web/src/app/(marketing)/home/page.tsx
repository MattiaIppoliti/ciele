import type { Metadata } from "next";
import { FeaturesSection, HeroSection } from "@/components/home/hero-section";
import { HomeSectionRail } from "@/components/home/home-section-rail";
import { CloudCallout } from "@/components/marketing/cloud-callout";
import { CtaSection } from "@/components/marketing/cta-section";

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
        {/* The same sign-off every marketing page ends on, so the home page
            hands over to the footer the way /features/* and /pricing do
            instead of stopping on the last feature card. bg-background keeps
            it on the white band the features sit on, above the footer sky. */}
        <section className="home-below-fold bg-background">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-8 lg:px-12">
            <CloudCallout
              expression="neutral"
              eyebrow="Meet your teammate"
              title="Happy to help, around the clock"
              body="Every Ciele assistant answers from your organization's own knowledge: websites, files and FAQs. It hands off to a human the moment it should."
              cta={{ label: "See how it works", href: "/features/assistants" }}
            />
          </div>
          <CtaSection
            lead="Built on your knowledge."
            trail="Answering today."
            primary={{ label: "Request a demo", href: "/contact/sales" }}
            secondary={{ label: "See pricing", href: "/pricing" }}
          />
        </section>
      </main>
    </>
  );
}
