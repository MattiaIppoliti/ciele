import type { Metadata } from "next";
import { hasActiveSession } from "@/lib/auth";
import { FeaturesSection, HeroSection } from "@/components/home/hero-section";
import { HomeFooter } from "@/components/home/home-footer";
import { HomeSectionRail } from "@/components/home/home-section-rail";
import { HomeShell } from "@/components/home/home-shell";

export const metadata: Metadata = {
  title: "Ciele, AI assistants for your business",
  description:
    "Build, test and publish AI assistants that answer from your organization's own knowledge.",
};

export default async function HomePage() {
  // Signed-in visitors get an "Open app" button instead of Login/Sign Up.
  // Presence-only check: the header needs a boolean, not the whole session,
  // so we avoid the org/profile/org-list Db reads getSession would run.
  const authenticated = await hasActiveSession();

  return (
    <HomeShell authenticated={authenticated}>
      <HomeSectionRail />
      <main>
        <HeroSection />
        <FeaturesSection />
      </main>
      <HomeFooter />
    </HomeShell>
  );
}
