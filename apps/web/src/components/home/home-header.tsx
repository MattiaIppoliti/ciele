"use client";

import Link from "next/link";
import React from "react";
import dynamic from "next/dynamic";
// Icon *data* (not components) for the two marks that reshape rather than
// swap: the theme toggle and the mobile menu button.
import { Menu as MenuData, Moon as MoonData, Sun as SunData, X as XData } from "lucide";
import { MorphIcon } from "morphicons/react";
import { Button, cn } from "@agent-hub/ui";
import { GhostMark } from "@/components/auth/ghost-mark";
import { GithubMark } from "@/components/home/github-mark";
import { Magnetic } from "@/components/core/magnetic";
import { useTheme } from "@/components/theme-provider";
import { MotionNavigationMenu } from "@/components/home/motion-navigation-menu";
import { Reveal } from "@/components/home/reveal";

// The mobile list is fetched only when the visitor opens the menu.
const MobileMenuList = dynamic(
  () => import("@/components/home/nav-panel").then((m) => m.MobileMenuList),
  { ssr: false }
);

/** The open-source repository, overridable by a fork (same key the installer and
 *  the download/pricing pages read). Inlined at build time by Next. */
const SOURCE_URL =
  process.env.NEXT_PUBLIC_SOURCE_URL || "https://github.com/MattiaIppoliti/ciele";

/* Until the visitor scrolls, the pill has no background of its own, so in dark
   mode these controls drew white glyphs straight onto the hero's white glow and
   all but disappeared, while "Get a demo" stayed readable because its pill
   backs the text. Give them a backing of their own: a pale, near-white grey
   with dark ink, the opposite pole of the near-black primary pill, so the
   secondary controls read instantly without competing with it. Dark-only:
   light mode is dark ink on a light hero and already reads, which is why it
   is untouched. */
const DARK_CONTROL =
  "dark:border-white/10 dark:bg-white/15 dark:text-white dark:backdrop-blur-sm dark:hover:bg-white/25 dark:hover:text-white";

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  // The server cannot know the visitor's theme, and a morph target that
  // differs between the two renders is a hydration mismatch. Draw the sun
  // until mounted, then let the real state morph it. `useSyncExternalStore`
  // rather than setState in an effect, which the repo's lint rules refuse.
  const mounted = React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  const dark = mounted && resolvedTheme === "dark";

  return (
    <Button
      variant="ghost"
      // icon-sm (28px) matches the h-7 of the sm Log in / Get a demo pills.
      size="icon-sm"
      aria-label="Toggle theme"
      // Dark is the pressed state. The cue is `sweep` rather than on/off
      // (#817): this control moves the whole sky from day to night, so it
      // sounds like air travelling, the same either way, and it replaces the
      // Button's own press/release so one press is one cue.
      aria-pressed={dark}
      data-foley-toggle="sweep"
      data-foley-press={undefined}
      data-foley-release={undefined}
      className={DARK_CONTROL}
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      {/* Sun and moon are one shape that reshapes, not two icons swapped by a
          `dark:hidden` pair (morphicons.com). */}
      <MorphIcon icon={dark ? MoonData : SunData} size={16} />
    </Button>
  );
}

/** The repo link, shaped exactly like the theme toggle beside it. */
function GithubLink() {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Ciele on GitHub"
      className={DARK_CONTROL}
      nativeButton={false}
      render={
        <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer" />
      }
    >
      <GithubMark className="size-4" />
    </Button>
  );
}

/**
 * Both CTA sets are rendered and CSS shows one, keyed on the signed-in hint that
 * an inline script puts on <html> before first paint (see lib/auth-hint.ts).
 *
 * Not a React branch on purpose: knowing the caller server-side meant reading a
 * cookie in the marketing layout, which made all seven pages dynamic. The hidden
 * half is `display: none`, so it is out of the accessibility tree too, a screen
 * reader announces one CTA, not both. Rules live in home.css.
 */
export function HomeHeader({ scrolled }: { scrolled: boolean }) {
  const [menuState, setMenuState] = React.useState(false);
  const [mobileGroup, setMobileGroup] = React.useState<string | null>(null);

  // A click on any link inside a CTA cluster closes the mobile menu.
  const closeOnLink = (event: React.MouseEvent) => {
    if ((event.target as HTMLElement).closest("a")) setMenuState(false);
  };

  return (
    <header>
      <nav
        data-state={menuState ? "active" : undefined}
        // Mobile (<lg) drives the pill's max-width from home.css off these
        // attributes rather than Tailwind's max-w-* utilities, so the scroll
        // morph can animate a length→length tween that beats the layered
        // utilities and stays in sync across auth/menu states.
        data-scrolled={scrolled ? "true" : undefined}
        className="fixed z-20 w-full px-2"
      >
        <div
          className={cn(
            // The border and radius exist in both states (transparent border
            // when expanded) so the pill morphs smoothly, otherwise the
            // 1px border pops in as a hard rectangle mid-transition.
            // max-lg:rounded-[2.5rem]: on mobile the pill is a stadium when
            // closed and reads as a rounded card once the menu stretches it
            // open (see home.css). At lg the desktop pill glides narrower.
            "mx-auto mt-2 max-w-6xl rounded-2xl border border-transparent px-6 transition-all duration-500 ease-in-out max-lg:rounded-[2.5rem] lg:px-12",
            // Collapse to a definite max-width (not max-w-fit): CSS reliably
            // tweens length→length everywhere, so the pill glides narrower
            // instead of snapping. Sized per auth state to clear the widest the
            // row can get, logo + the three nav items (two of them dropdown
            // triggers, so they carry a chevron) + the CTA cluster. Too narrow
            // and the row squeezes or wraps instead of gliding, the four nav
            // items alone measure ~680px at rest.
            // The signed-out width is the wider one; home.css trims it for a
            // signed-in caller, since that is now a CSS fact, not a React one.
            scrolled &&
              // The GitHub link added a 32px control + its gap to the cluster,
              // hence the extra 2.75rem here and in home.css's signed-in trim.
              "bg-background/50 border-border backdrop-blur-lg max-w-[58.25rem] lg:px-6"
          )}
        >
          <div
            className={cn(
              // justify-between in BOTH states with no lg gap: while wide the
              // links spread edge-to-edge; as the pill's max-width tweens
              // narrower on scroll, justify-between keeps distributing the
              // shrinking free space so the groups glide together, one
              // animatable property (max-width), no layout-mode swap, no jump.
              // gap-0 on mobile keeps the closed pill slim (the menu card is
              // pulled out of flow, see home.css).
              // lg:flex-nowrap: on desktop the row is one line, always. Mobile
              // still wraps; that is how the menu card drops below the pill.
              "relative flex flex-wrap items-center justify-between gap-0 py-3 transition-[padding] duration-500 ease-in-out lg:flex-nowrap lg:gap-0 lg:py-4",
              scrolled && "lg:py-2.5"
            )}
          >
            <div className="flex w-full items-center justify-between lg:w-auto">
              <Link
                href="/home"
                aria-label="home"
                data-ghost-logo
                className="flex items-center gap-2 font-medium"
              >
                <GhostMark className="size-7" eyesClassName="ghost-logo-eyes" />
                <span className="font-brand text-lg font-medium leading-none">Ciele</span>
              </Link>

              {/* Mobile top-bar controls: theme toggle sits to the left of the
                  menu/close mark in both the closed pill and the open card. */}
              <div className="-mr-2 flex items-center gap-1 lg:hidden">
                <GithubLink />
                <ThemeToggle />
                <button
                  onClick={() => {
                    // Closing collapses whatever was expanded, so reopening
                    // starts from the four macro areas again.
                    if (menuState) setMobileGroup(null);
                    setMenuState(!menuState);
                  }}
                  aria-label={menuState ? "Close Menu" : "Open Menu"}
                  data-foley-click={menuState ? "close" : "open"}
                  className="relative z-20 block cursor-pointer p-2.5"
                >
                  {/* One mark that reshapes open to close: the bars of the
                      menu glyph spring into the cross (morphicons.com), which
                      says more than the rotated plus it replaces. */}
                  <MorphIcon
                    icon={menuState ? XData : MenuData}
                    size={24}
                    className="m-auto"
                  />
                </button>
              </div>
            </div>

            <MotionNavigationMenu scrolled={scrolled} />

            <div className="home-mobile-menu bg-background lg:in-data-[state=active]:flex mb-6 w-full flex-wrap items-center justify-end space-y-8 rounded-3xl border p-6 shadow-2xl shadow-zinc-300/20 md:flex-nowrap lg:m-0 lg:flex lg:w-fit lg:gap-6 lg:space-y-0 lg:border-transparent lg:bg-transparent lg:p-0 lg:shadow-none dark:shadow-none dark:lg:bg-transparent">
              {/* Mobile: menu links pinned to the top of the card. */}
              {/* Mounted with the card, which is the first moment it can be
                  seen; on a desktop visit it is never fetched at all. */}
              {menuState && (
                <MobileMenuList
                  openGroup={mobileGroup}
                  onToggleGroup={(name) =>
                    setMobileGroup((current) => (current === name ? null : name))
                  }
                  onNavigate={() => setMenuState(false)}
                />
              )}

              {/* Desktop inline nav cluster (theme toggle + CTAs); hidden on
                  mobile, where the top bar and the buttons below take over. */}
              <div
                onClick={closeOnLink}
                className="hidden items-center gap-3 lg:flex"
              >
                <GithubLink />
                <ThemeToggle />
                {/* `display: contents` while shown, so the cluster's gap-3 still
                    spaces the buttons themselves, see home.css. */}
                <div className="home-cta-authed">
                  <Magnetic range={38} intensity={0.14} maxOffset={7}>
                    <Button size="sm" nativeButton={false} render={<Link href="/" />}>
                      <span>Open app</span>
                    </Button>
                  </Magnetic>
                </div>
                <div className="home-cta-anon">
                  <Button
                    variant="outline"
                    size="sm"
                    className={DARK_CONTROL}
                    nativeButton={false}
                    render={<Link href="/login" />}
                  >
                    <span>Log in</span>
                  </Button>
                  <Magnetic range={38} intensity={0.14} maxOffset={7}>
                    <Button
                      size="sm"
                      nativeButton={false}
                      render={<Link href="/contact/sales" />}
                    >
                      <span>Get a demo</span>
                    </Button>
                  </Magnetic>
                </div>
              </div>

              {/* Mobile: large CTA buttons absolutely pinned to the bottom
                  edge, so they ride it down smoothly as the card grows. */}
              <div
                onClick={closeOnLink}
                className="absolute inset-x-6 bottom-8 flex flex-col gap-3 lg:hidden"
              >
                <div className="home-cta-authed">
                  <Reveal delay={0.34}>
                    <Button
                      className="h-14 w-full rounded-full text-base font-medium"
                      nativeButton={false}
                      render={<Link href="/" />}
                    >
                      <span>Open app</span>
                    </Button>
                  </Reveal>
                </div>
                <div className="home-cta-anon">
                  <Reveal delay={0.34}>
                    <Button
                      className="h-14 w-full rounded-full text-base font-medium"
                      nativeButton={false}
                      render={<Link href="/contact/sales" />}
                    >
                      <span>Get a demo</span>
                    </Button>
                  </Reveal>
                  <Reveal delay={0.42}>
                    <Button
                      variant="secondary"
                      className="h-14 w-full rounded-full text-base font-medium"
                      nativeButton={false}
                      render={<Link href="/login" />}
                    >
                      <span>Log in</span>
                    </Button>
                  </Reveal>
                </div>
              </div>
            </div>
          </div>
        </div>
      </nav>
    </header>
  );
}
