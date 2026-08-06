"use client";

import React from "react";
import { HomeCursorMount } from "@/components/home/home-cursor-mount";
import { HomeHeader } from "@/components/home/home-header";

/* The root layout pins <body> to h-screen/overflow-hidden (app shell), so
   the marketing page scrolls inside its own container — window scroll never
   fires here, hence the onScroll listener lives on this div. */
export function HomeShell({ children }: { children: React.ReactNode }) {
  const [scrolled, setScrolled] = React.useState(false);

  return (
    <div
      className="home-scene bg-background text-foreground h-full overflow-y-auto"
      onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 50)}
    >
      <HomeHeader scrolled={scrolled} />
      {children}
      <HomeCursorMount />
    </div>
  );
}
