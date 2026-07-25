"use client";

import Link from "next/link";
import React from "react";
import { Moon, Plus, Sun } from "lucide-react";
import { Button, cn } from "@agent-hub/ui";
import { GhostMark } from "@/components/auth/ghost-mark";
import { Magnetic } from "@/components/core/magnetic";
import { useTheme } from "@/components/theme-provider";

const menuItems = [
  { name: "Features", href: "#features" },
  { name: "Docs", href: "https://docs.ciele.app", external: true },
];

/**
 * Blur + rise + fade reveal for the mobile menu items
 * (beui.dev/components/motion/text-animation), driven purely by the nav's open
 * state via CSS (see home.css `.home-reveal`, gated on `nav[data-state=active]`).
 * `delay` staggers each item on open and resets quickly on close so it replays.
 */
function Reveal({
  delay,
  className,
  children,
}: {
  delay: number;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn("home-reveal", className)}
      style={{ "--reveal-delay": `${delay}s` } as React.CSSProperties}
    >
      {children}
    </div>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle theme"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <Sun className="dark:hidden" />
      <Moon className="hidden dark:block" />
    </Button>
  );
}

export function HomeHeader({
  authenticated,
  scrolled,
}: {
  authenticated: boolean;
  scrolled: boolean;
}) {
  const [menuState, setMenuState] = React.useState(false);

  return (
    <header>
      <nav
        data-state={menuState ? "active" : undefined}
        // Mobile (<lg) drives the pill's max-width from home.css off these
        // attributes rather than Tailwind's max-w-* utilities, so the scroll
        // morph can animate a length→length tween that beats the layered
        // utilities and stays in sync across auth/menu states.
        data-scrolled={scrolled ? "true" : undefined}
        data-auth={authenticated ? "true" : undefined}
        className="fixed z-20 w-full px-2"
      >
        <div
          className={cn(
            // The border and radius exist in both states (transparent border
            // when expanded) so the pill morphs smoothly — otherwise the
            // 1px border pops in as a hard rectangle mid-transition.
            // max-lg:rounded-[2.5rem]: on mobile the pill is a stadium when
            // closed and reads as a rounded card once the menu stretches it
            // open (see home.css). At lg the desktop pill glides narrower.
            "mx-auto mt-2 max-w-6xl rounded-2xl border border-transparent px-6 transition-all duration-500 ease-in-out max-lg:rounded-[2.5rem] lg:px-12",
            // Collapse to a definite max-width (not max-w-fit): CSS reliably
            // tweens length→length everywhere, so the pill glides narrower
            // instead of snapping. Sized per auth state so the two links sit
            // an even ~32px from the logo and CTA at rest.
            scrolled &&
              cn(
                "bg-background/50 border-border backdrop-blur-lg lg:px-6",
                authenticated ? "max-w-md" : "max-w-[34rem]"
              )
          )}
        >
          <div
            className={cn(
              // justify-between in BOTH states with no lg gap: while wide the
              // links spread edge-to-edge; as the pill's max-width tweens
              // narrower on scroll, justify-between keeps distributing the
              // shrinking free space so the groups glide together — one
              // animatable property (max-width), no layout-mode swap, no jump.
              // gap-0 on mobile keeps the closed pill slim (the menu card is
              // pulled out of flow — see home.css).
              "relative flex flex-wrap items-center justify-between gap-0 py-3 transition-[padding] duration-500 ease-in-out lg:gap-0 lg:py-4",
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
                  +/× in both the closed pill and the open card. */}
              <div className="-mr-2 flex items-center gap-1 lg:hidden">
                <ThemeToggle />
                <button
                  onClick={() => setMenuState(!menuState)}
                  aria-label={menuState ? "Close Menu" : "Open Menu"}
                  className="relative z-20 block cursor-pointer p-2.5"
                >
                  {/* A plus rotated 135° reads as a × — one mark morphs
                      open→close with the same springy timing as the card. */}
                  <Plus className="in-data-[state=active]:rotate-[135deg] m-auto size-6 transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]" />
                </button>
              </div>
            </div>

            <div className="hidden size-fit lg:block">
              <ul className="flex gap-8 text-sm">
                {menuItems.map((item) => (
                  <li key={item.name}>
                    <Link
                      href={item.href}
                      target={item.external ? "_blank" : undefined}
                      rel={item.external ? "noopener noreferrer" : undefined}
                      className="text-muted-foreground hover:text-foreground block duration-150"
                    >
                      <span>{item.name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            <div className="home-mobile-menu bg-background lg:in-data-[state=active]:flex mb-6 w-full flex-wrap items-center justify-end space-y-8 rounded-3xl border p-6 shadow-2xl shadow-zinc-300/20 md:flex-nowrap lg:m-0 lg:flex lg:w-fit lg:gap-6 lg:space-y-0 lg:border-transparent lg:bg-transparent lg:p-0 lg:shadow-none dark:shadow-none dark:lg:bg-transparent">
              {/* Mobile: large menu links, pinned to the top of the card */}
              <ul className="mt-10 space-y-6 lg:hidden">
                {menuItems.map((item, i) => (
                  <li key={item.name}>
                    <Reveal delay={0.05 + i * 0.08}>
                      <Link
                        href={item.href}
                        target={item.external ? "_blank" : undefined}
                        rel={item.external ? "noopener noreferrer" : undefined}
                        onClick={() => setMenuState(false)}
                        className="text-muted-foreground hover:text-foreground block text-4xl font-light tracking-tight duration-150"
                      >
                        <span>{item.name}</span>
                      </Link>
                    </Reveal>
                  </li>
                ))}
              </ul>

              {/* Desktop inline nav cluster (theme toggle + CTAs); hidden on
                  mobile, where the top bar and the buttons below take over. */}
              <div
                onClick={(event) => {
                  if ((event.target as HTMLElement).closest("a")) {
                    setMenuState(false);
                  }
                }}
                className="hidden items-center gap-3 lg:flex"
              >
                <ThemeToggle />
                {authenticated ? (
                  <Magnetic range={38} intensity={0.14} maxOffset={7}>
                    <Button size="sm" nativeButton={false} render={<Link href="/" />}>
                      <span>Open app</span>
                    </Button>
                  </Magnetic>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
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
                  </>
                )}
              </div>

              {/* Mobile: large CTA buttons absolutely pinned to the bottom
                  edge, so they ride it down smoothly as the card grows. */}
              <div
                onClick={(event) => {
                  if ((event.target as HTMLElement).closest("a")) {
                    setMenuState(false);
                  }
                }}
                className="absolute inset-x-6 bottom-8 flex flex-col gap-3 lg:hidden"
              >
                {authenticated ? (
                  <Reveal delay={0.34}>
                    <Button
                      className="h-14 w-full rounded-full text-base font-medium"
                      nativeButton={false}
                      render={<Link href="/" />}
                    >
                      <span>Open app</span>
                    </Button>
                  </Reveal>
                ) : (
                  <>
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
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </nav>
    </header>
  );
}
