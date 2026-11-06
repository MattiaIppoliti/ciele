import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { RollInText } from "@/components/motion/roll-in-text";
import { cn } from "@/lib/utils";

/**
 * Operational headings stay static and compact, and a console page passes no
 * icon: the title names the page and the sidebar row already shows its glyph.
 * The one console exception is an entity with an icon of its own (a Project).
 * Public feature pages opt into the decorative icon tile and title entrance.
 */
export function SectionHeading({
  icon: Icon,
  title,
  description,
  eyebrow,
  variant = "console",
  headingLevel = 1,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  eyebrow?: string;
  variant?: "console" | "marketing" | "mock";
  headingLevel?: 1 | 2 | 3;
  className?: string;
}) {
  const marketing = variant === "marketing";
  const mock = variant === "mock";
  const Heading = headingLevel === 1 ? "h1" : headingLevel === 2 ? "h2" : "h3";

  if (!marketing && !mock) {
    // The console heading: the page title at display size, the description
    // under it. An entity's own icon (a Project's), when passed, is scaled to
    // the title's first line (sized in em, so it follows the clamp).
    return (
      <div className={cn("mb-8 min-w-0 text-left", className)}>
        {eyebrow && <p className="text-muted-foreground mb-2 text-sm font-medium">{eyebrow}</p>}
        <div className="text-display flex items-start gap-[0.25em]">
          {Icon && <Icon aria-hidden strokeWidth={1.75} className="text-muted-foreground mt-[0.2em] size-[0.6em] shrink-0" />}
          <Heading className="min-w-0">{title}</Heading>
        </div>
        {description && <p className="text-muted-foreground mt-3 max-w-[65ch] text-base leading-relaxed">{description}</p>}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex items-center text-left",
        marketing
          ? "mx-auto w-fit max-w-full justify-center gap-4 sm:gap-6"
          : mock
            ? "gap-3"
            : "items-start gap-3",
        className
      )}
    >
      {Icon && <div
        className={cn(
          "relative flex shrink-0 items-center justify-center",
          (marketing || mock) && "bg-card ring-foreground/10 overflow-hidden shadow-light ring-1",
          marketing
            ? "size-16 rounded-2xl sm:size-20 sm:rounded-[1.35rem]"
            : mock
              ? "size-12 rounded-xl"
              : "mt-0.5 size-6 text-muted-foreground"
        )}
      >
        {(marketing || mock) && <><div
          aria-hidden
          className={cn(
            "absolute inset-0 [background-image:linear-gradient(to_right,var(--color-foreground)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-foreground)_1px,transparent_1px)] [background-position:center] opacity-25 [mask-image:radial-gradient(circle_at_center,black_25%,transparent_72%)]",
            mock ? "[background-size:9.6px_9.6px]" : "[background-size:12.8px_12.8px]"
          )}
        />
        <div
          aria-hidden
          className="from-foreground/8 absolute inset-0 bg-gradient-to-b to-transparent to-60%"
        />
        <div
          aria-hidden
          className="via-foreground/25 absolute inset-x-2 top-0 h-px bg-gradient-to-r from-transparent to-transparent"
        /></>}
        <Icon
          className={cn(
            "relative",
            marketing ? "size-7 sm:size-8" : "size-5"
          )}
          aria-hidden
        />
      </div>}

      <div className="min-w-0">
        {eyebrow && (
          <p
            className={cn(
              "text-muted-foreground font-mono font-medium uppercase tracking-wider",
              marketing ? "mb-2 text-xs" : "mb-1 text-2xs"
            )}
          >
            {eyebrow}
          </p>
        )}
        <Heading
          className={cn(
            "font-semibold tracking-tight",
            marketing
              ? "text-3xl text-balance sm:text-4xl"
              : mock
                ? "text-lg"
                : "text-2xl"
          )}
        >
          {marketing ? <RollInText text={title} /> : title}
        </Heading>
        {description && <p
          className={cn(
            "text-muted-foreground",
            marketing
              ? "mt-2 max-w-3xl text-base leading-relaxed text-pretty sm:text-lg"
              : mock
                ? "mt-0.5 truncate text-xs"
                : "mt-1 text-sm"
          )}
        >
          {description}
        </p>}
      </div>
    </div>
  );
}
