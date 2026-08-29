import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Product-shaped heading shared by the console and the public feature pages.
 * The icon tile deliberately mirrors the SETUP navigation: it makes a public
 * feature recognisable as the same surface visitors later meet in Ciele.
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
  icon: LucideIcon;
  title: string;
  description: string;
  eyebrow?: string;
  variant?: "console" | "marketing" | "mock";
  headingLevel?: 1 | 2 | 3;
  className?: string;
}) {
  const marketing = variant === "marketing";
  const mock = variant === "mock";
  const Heading = headingLevel === 1 ? "h1" : headingLevel === 2 ? "h2" : "h3";

  return (
    <div
      className={cn(
        "flex items-center text-left",
        marketing
          ? "mx-auto w-fit max-w-full justify-center gap-4 sm:gap-6"
          : mock
            ? "gap-3"
            : "gap-5",
        className
      )}
    >
      <div
        className={cn(
          "bg-card ring-foreground/10 relative flex shrink-0 items-center justify-center overflow-hidden shadow-sm ring-1",
          marketing
            ? "size-16 rounded-2xl sm:size-20 sm:rounded-[1.35rem]"
            : mock
              ? "size-12 rounded-xl"
              : "size-16 rounded-2xl"
        )}
      >
        <div
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
        />
        <Icon
          className={cn(
            "relative",
            marketing ? "size-7 sm:size-8" : mock ? "size-5" : "size-7"
          )}
          aria-hidden
        />
      </div>

      <div className="min-w-0">
        {eyebrow && (
          <p
            className={cn(
              "text-muted-foreground font-mono font-medium uppercase tracking-wider",
              marketing ? "mb-2 text-xs" : "mb-1 text-[10px]"
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
          {title}
        </Heading>
        <p
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
        </p>
      </div>
    </div>
  );
}
