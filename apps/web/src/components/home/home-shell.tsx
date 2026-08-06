"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { HomeCursorMount } from "@/components/home/home-cursor-mount";
import { HomeHeader } from "@/components/home/home-header";
import { MarketingScene } from "@/components/home/marketing-scene";

/* The root layout pins <body> to h-screen/overflow-hidden (app shell), so
   the marketing page scrolls inside its own container — window scroll never
   fires here, hence the onScroll listener lives on this div. */
export function HomeShell({ children }: { children: React.ReactNode }) {
  const [scrolled, setScrolled] = React.useState(false);
  const pathname = usePathname();

  return (
    <MarketingScene
      className="bg-background text-foreground"
      onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 50)}
      showClouds={pathname !== "/home"}
    >
      <HomeHeader scrolled={scrolled} />
      {children}
      <HomeCursorMount />
    </MarketingScene>
  );
}
