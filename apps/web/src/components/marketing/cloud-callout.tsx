import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { BLOUB_SVGS, type CloudExpression } from "@/components/marketing/bloub";
import { CloudAvatar } from "@/components/marketing/cloud-avatar";
import { cn } from "@/lib/utils";

export type { CloudExpression };

/**
 * The mascot band every marketing page carries: a rounded card with the
 * page's copy on the left and the animated cloud drawn LARGER than the card.
 * On ≥sm screens it hangs past the card's top edge; on mobile it tucks into
 * the bottom-right corner and is clipped by the card, x.ai-bot style. The
 * card follows the theme, light panel with an ink cloud in light mode, dark
 * panel with a white cloud in dark mode, via the `--bloub-*` fills the
 * generated SVGs read.
 */
export function CloudCallout({
  expression,
  eyebrow,
  title,
  body,
  cta,
  className,
}: {
  expression: CloudExpression;
  eyebrow: string;
  title: ReactNode;
  body: ReactNode;
  cta?: { label: string; href: string };
  className?: string;
}) {
  return (
    <section className={cn("relative mt-24", className)}>
      {/* The avatar is placed two ways, and lg is the switch: below it (phones
          AND tablets) the cloud is cropped by the card's bottom-right corner,
          so it never collides with the copy on a narrow column; at lg it rises
          above the card's top edge instead, which needs the extra mt and the
          tall pb dropped. The eye holes match the card face either way.

          overflow-clip, not -hidden: hidden still makes a programmatic scroll
          container, and anything (focus, scrollIntoView) that targets the
          overhanging avatar would shift the card's content sideways. */}
      <div className="relative overflow-clip rounded-3xl border border-zinc-200 bg-zinc-100 px-6 pb-40 pt-12 [--bloub-body:#0a0a0c] [--bloub-eyes:#f4f4f5] sm:px-10 lg:mt-20 lg:overflow-visible lg:px-14 lg:py-14 dark:border-zinc-800 dark:bg-zinc-900/60 dark:[--bloub-body:#fafafa] dark:[--bloub-eyes:#131318]">
        {/* Phones + tablets: cropped by the card's bottom-right corner. */}
        <CloudAvatar
          svg={BLOUB_SVGS[expression]}
          className="absolute -bottom-14 -right-14 w-52 sm:-bottom-16 sm:-right-16 sm:w-64 lg:hidden"
        />

        {/* ≥lg: oversized, overflowing the card's top on the right. */}
        <CloudAvatar
          svg={BLOUB_SVGS[expression]}
          className="absolute -top-24 right-14 hidden w-80 lg:block"
        />

        <div className="relative max-w-xl">
          <p className="text-muted-foreground font-mono text-xs font-medium uppercase tracking-wider">
            {eyebrow}
          </p>
          <h2 className="text-foreground mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
            {title}
          </h2>
          <p className="text-muted-foreground mt-4 text-base leading-relaxed">
            {body}
          </p>
          {cta && (
            <Link
              href={cta.href}
              className="text-foreground group mt-6 inline-flex items-center gap-2 text-sm font-medium"
            >
              {cta.label}
              <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
