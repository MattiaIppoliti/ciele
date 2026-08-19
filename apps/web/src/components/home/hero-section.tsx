import Link from "next/link";
import { type CSSProperties } from "react";
import { ArrowRight } from "lucide-react";
import { HeroGhost } from "@/components/home/hero-ghost";
import { HomeAppPreview } from "@/components/home/app-preview";
import { InstallCommand } from "@/components/marketing/install-command";
import { DownloadCta } from "@/components/home/download-cta";
import { FeaturesGrid } from "@/components/home/features-grid";
import { MobileAppPreview } from "@/components/home/mobile-app-preview";
import { PreviewStage } from "@/components/home/preview-stage";
import { HeroClouds } from "@/components/home/hero-clouds";
import {
  FallingStars,
  FlyingBirds,
  StarField,
} from "@/components/home/sky";
import { SkySceneTransition } from "@/components/home/sky-transition";
import { ChromaticTextReveal } from "@/components/motion/text-animation";
import { resolveSelfHostInstallCommand } from "@/lib/self-host-install";
import { cn } from "@/lib/utils";

export function HeroSection() {
  const installCommand = resolveSelfHostInstallCommand();

  return (
    <section id="overview" className="relative isolate overflow-hidden scroll-mt-24">
      {/* Day sky / dusk / starry night backdrops, all mounted so a theme
          toggle can crossfade through sunset colors (see home.css,
          data-sky-transition). isolate keeps the -z-10 layers inside this
          section instead of behind the page bg. */}
      <div aria-hidden="true" className="home-sky-light absolute inset-0 -z-10" />
      <div aria-hidden="true" className="home-sky-sunset absolute inset-0 -z-10" />
      <div aria-hidden="true" className="home-sky-dark absolute inset-0 -z-10" />

      {/* Flags theme toggles on <html> so the sun/moon handoff animates. */}
      <SkySceneTransition />

      {/* Sun, visible in light mode; on a theme toggle its track arcs it
          down-left, shifting yellow → orange, before the moon takes over. */}
      <div
        aria-hidden="true"
        className="home-sun-track pointer-events-none absolute -top-24 right-[8%] size-80"
      >
        <div className="home-sun size-full" />
      </div>

      {/* Loose bird formations animate across the daytime sky. */}
      <FlyingBirds className="home-day-fade" />

      {/* Moon, dark mode counterpart; rises in from beyond the right edge
          to the sun's spot during the day → night handoff. */}
      <div
        aria-hidden="true"
        className="home-moon-track pointer-events-none absolute -top-24 right-[8%] size-80"
      >
        <div className="home-moon size-full" />
      </div>

      {/* Twinkling stars + falling-star streaks, dark mode only. */}
      <StarField dense className="home-night-fade" />
      <FallingStars className="home-night-fade" />

      {/* Painterly clouds, both themes, dimmed to moonlit tones in dark.
          Client component: entrance from the edges + scroll-linked motion. */}
      <HeroClouds />

      <div className="mx-auto max-w-7xl px-6 pb-8 pt-36 md:pt-44">
        <div className="text-center">
          <Link
            href="/contact/sales"
            className="bg-background/60 hover:bg-background group mx-auto flex w-fit items-center gap-3 rounded-full border p-1 pl-4 shadow-md shadow-zinc-950/5 backdrop-blur transition-colors duration-300"
          >
            <span className="text-foreground text-sm">
              Introducing Ciele, AI Teammates for your business
            </span>
            <span className="bg-background flex size-6 items-center justify-center rounded-full duration-300 group-hover:translate-x-0.5">
              <ArrowRight className="size-3" />
            </span>
          </Link>

          {/* Same type treatment as the page's closing line in `CtaSection`:
              semibold, tight tracking, and the fade painted into the type
              itself, so the fold and the sign-off read as one voice. The
              rotating word paints its own chromatic gradient and the mascot is
              an SVG with literal fills, so neither inherits the transparency. */}
          <h1
            className="home-reveal-hero from-foreground to-foreground/25 mx-auto mt-8 max-w-4xl bg-gradient-to-b bg-clip-text text-5xl font-semibold tracking-tight text-balance text-transparent md:max-w-5xl md:text-pretty md:text-6xl xl:max-w-6xl xl:text-7xl"
            style={{ "--reveal-delay": "0.05s" } as CSSProperties}
          >
            Your organization&apos;s{" "}
            <span className="whitespace-nowrap">AI Teammates,</span>{" "}
            {/* Desktop (lg+): hard break so the headline is exactly two lines,
                only where line 1 fits at the current font size. Below lg the
                break is hidden and the text wraps freely. */}
            <br className="hidden lg:block" />
            above the{" "}
            {/* Keep the ghost + "clouds" on the same line. Plain inline (not
                flex) so "clouds" shares the text baseline with "above the";
                the ghost is baseline-aligned then nudged to sit optically on
                the row. */}
            <span className="whitespace-nowrap">
              <HeroGhost className="mr-[0.18em] inline-block h-[0.9em] w-auto align-[-0.16em]" />
              {/* The closing noun rotates under the chromatic sweep:
                  clouds → sky → ciele → cielo → back to clouds. No prefix,
                  the ghost sits immediately before it. */}
              <ChromaticTextReveal
                words={["clouds", "sky", "ciele", "cielo"]}
                // The h1 paints a top-to-bottom fade over the whole block, and
                // this word paints its own gradient, so it cannot inherit that
                // fade. Left at full --foreground it settled two tones darker
                // than the "above the" beside it. This is what the h1's fade
                // works out to on the last line, so the row lands as one color.
                foregroundColor="color-mix(in oklab, var(--foreground) 45%, transparent)"
                delay={0.05}
                duration={1.1}
                pauseDuration={1.6}
                // Above the fold: run on mount instead of waiting on an
                // IntersectionObserver frame, which never arrives in hidden or
                // prerendering tabs and would leave the word clipped away.
                startOnView={false}
              />
            </span>
          </h1>
          <p
            className="home-reveal-hero text-muted-foreground mx-auto mt-8 max-w-2xl text-balance text-lg"
            style={{ "--reveal-delay": "0.18s" } as CSSProperties}
          >
            Build, test and publish AI Teammates that answer from your own
            knowledge.
          </p>

          {/* The fold's only call to action: the self-host one-liner, copyable
              on the spot. Same command the download page hands out, built by
              the module that serves the script, so the two can never drift
              apart. A build that cannot prove its own origin drops the row
              instead of showing a command that would 404. */}
          {installCommand && (
            <div
              className="home-reveal-hero mx-auto mt-12 max-w-xl"
              style={{ "--reveal-delay": "0.32s" } as CSSProperties}
            >
              <InstallCommand command={installCommand} />
              {/* Same grey voice as the subtitle above: a bare command tells a
                  visitor nothing, and this one is worth explaining because it
                  is the whole product, not a client library. */}
              <p className="text-muted-foreground mt-4 text-balance text-[15px]">
                Downloads and runs the whole stack on your own machine:
                console, widget, database, background jobs.{" "}
                <Link
                  href="/download"
                  className="text-foreground underline underline-offset-4 hover:no-underline"
                >
                  Run it yourself
                </Link>
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Tilted product preview, triggerly-style 3D perspective plane,
          rendered as live DOM (crisp + clickable) instead of a screenshot. */}
      <PreviewStage
        id="preview"
        className="relative mt-2 hidden h-[560px] scroll-mt-24 overflow-hidden sm:block md:h-[660px]"
        style={{
          contain: "strict",
          perspective: "4000px",
          perspectiveOrigin: "100% 0",
          transformStyle: "preserve-3d",
        }}
      >
        {/* Extra night sky around the dashboard, the section-wide field
            thins out this far down, so add a dense cluster + falling
            streaks that frame the tilted preview. Dark mode only, behind
            the plane. */}
        <StarField dense className="home-night-fade" />
        <FallingStars className="home-night-fade" />

        {/* The projected (tilted) card spans ~1543×s px starting at this
            element's left edge and its top sits ~147×s px above the margin
            box. The stepped vars scale the whole composition with the
            viewport so it stays as large as possible while both top and
            right corners remain on-screen at every width:
            --plane-s: scale · --plane-half: 771.5×s (centers the projected
            box) · --plane-mt: 147×s+12 (clears the top corner). */}
        <div
          className={cn(
            "[--plane-s:0.8] [--plane-half:631px] [--plane-mt:130px] [--plane-shift:8px]",
            "min-[1366px]:[--plane-s:0.855] min-[1366px]:[--plane-half:674px] min-[1366px]:[--plane-mt:138px] min-[1366px]:[--plane-shift:16px]",
            "min-[1500px]:[--plane-s:0.94] min-[1500px]:[--plane-half:741px] min-[1500px]:[--plane-mt:150px] min-[1500px]:[--plane-shift:24px]",
            "min-[1650px]:[--plane-s:1.035] min-[1650px]:[--plane-half:816px] min-[1650px]:[--plane-mt:164px]",
            "min-[1800px]:[--plane-s:1.13] min-[1800px]:[--plane-half:891px] min-[1800px]:[--plane-mt:178px]",
            "min-[1950px]:[--plane-s:1.225] min-[1950px]:[--plane-half:966px] min-[1950px]:[--plane-mt:192px]"
          )}
          style={{
            width: 1600,
            height: 900,
            // --plane-shift nudges the composition slightly right of center.
            margin:
              "var(--plane-mt) 0 0 calc(50% - var(--plane-half) + var(--plane-shift))",
            transformOrigin: "0 0",
            backfaceVisibility: "hidden",
            transform:
              "scale(var(--plane-s)) rotateX(47deg) rotateY(31deg) rotate(324deg)",
            transformStyle: "preserve-3d",
          }}
        >
          {/* No backdrop-filter here: a blur inside a 3D-transformed plane
              forces pathological rasterization (screenshots/scroll jank).
              Translucent gray frame (same in both themes) so the sky shows
              through evenly around the whole mock. w-fit: the mock is a
              fixed 1600px inside a 1600px plane, so without it the padded
              frame gets overflowed on the right and the top-right corner
              of the dashboard pokes out unframed. */}
          <div className="ring-border/60 w-fit rounded-2xl border bg-zinc-500/25 p-2 shadow-2xl shadow-indigo-950/40 ring-1">
            <HomeAppPreview />
          </div>
        </div>
        {/* Fade the plane into the next section's background; must not
            swallow clicks on the preview underneath. */}
        <div className="to-background pointer-events-none absolute inset-x-0 bottom-0 h-44 bg-gradient-to-b from-transparent" />
      </PreviewStage>

      {/* Mobile: the same live mock, flat, the 3D plane doesn't fit small
          screens. Compact mode frames the top-left of the app (sidebar +
          header + main pane) and keeps the desktop's idle 1.5s view
          cycling, scaled to the phone's width. */}
      <div className="mt-12 px-4 pb-16 sm:hidden">
        <div className="rounded-2xl border bg-zinc-500/25 p-1.5 shadow-xl backdrop-blur">
          <MobileAppPreview />
        </div>
      </div>
    </section>
  );
}

export function FeaturesSection() {
  return (
    <section
      id="features"
      className="home-below-fold bg-background scroll-mt-24 pb-10 pt-24"
    >
      <div className="mx-auto max-w-5xl px-6">
        {/* Download CTA sitting between the hero mock and the heading: a pill
            that morphs into a full-screen desktop-app early-access panel. */}
        <DownloadCta />

        <h2 className="text-center text-3xl font-semibold md:text-4xl">
          Everything an assistant needs
        </h2>
        <FeaturesGrid />
      </div>
    </section>
  );
}
