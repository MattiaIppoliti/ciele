"use client";

import Link from "next/link";
import { useLinkStatus } from "next/link";
import { Loader2 } from "lucide-react";

import { AnimatedGlyph } from "@/components/ui/animated-icon";
import { Maximize2Icon } from "@/components/ui/icons/maximize-2";
import { cn } from "@/lib/utils";

/**
 * The Open control a row's title cell reveals on hover.
 *
 * A row in these tables is a thing with a page of its own: a Source has its
 * Documents, a Document has its content, chunks and memories. The title has
 * always been a link, but a link is the same affordance as the six other
 * links in the row and says nothing about there being a whole layer behind
 * it. This says it, in the place the reader's pointer already is, and it is
 * the same gesture in every table.
 *
 * It sits at the cell's right edge over a short gradient rather than beside
 * the title, because a control that appears inline reflows the text under the
 * pointer, and because a long URL should be covered rather than shortened.
 * Hidden until hover or keyboard focus; `group/row` is on the row.
 */
export function TableOpenCell({
  href,
  label,
  className,
  children,
}: {
  /** The next layer. */
  href: string;
  /** Names the row for a screen reader: "Open Ciele Docs". */
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("relative min-w-0", className)}>
      {children}
      <span
        aria-hidden
        className="from-card pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l to-transparent opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100"
      />
      <Link
        href={href}
        aria-label={`Open ${label}`}
        // Once clicked it stays up: the next layer is a server render, and a
        // control that fades out on `mouseleave` while the page is still
        // loading is the dead-click case response feedback exists to prevent.
        className="press-control bg-card hover:bg-accent focus-visible:outline-ring absolute top-1/2 right-0 inline-flex -translate-y-1/2 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[0.7rem] font-medium tracking-wide uppercase opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 has-[[data-pending]]:opacity-100"
      >
        <OpenGlyph />
        Open
      </Link>
    </div>
  );
}

/**
 * The pill's glyph: the console's animated maximize, which becomes a spinner
 * while the navigation is in flight. `useLinkStatus` only reports from inside
 * the `<Link>`, which is why this is a component rather than a flag.
 */
function OpenGlyph() {
  const { pending } = useLinkStatus();
  return pending ? (
    <Loader2 className="size-3 animate-spin" data-pending="" />
  ) : (
    // The same glyph and the same draw-on-hover as the full-screen control
    // in the Improvements drawer, because they do the same thing.
    <AnimatedGlyph icon={Maximize2Icon} size={12} />
  );
}
