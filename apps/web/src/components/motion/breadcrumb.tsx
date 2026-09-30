"use client";

import { ChevronRight, Ellipsis } from "lucide-react";
import {
  AnimatePresence,
  LayoutGroup,
  motion,
  useIsPresent,
  useReducedMotion,
  type HTMLMotionProps,
} from "motion/react";
import Link from "next/link";
import {
  Children,
  forwardRef,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  useId,
  type ComponentProps,
  type ComponentPropsWithRef,
} from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@agent-hub/ui";
import { EASE_OUT, SPRING_LAYOUT } from "@/lib/ease";
import { cn } from "@/lib/utils";

export type BreadcrumbProps = ComponentPropsWithRef<"nav">;

/** A navigation landmark. Keep it mounted while the route changes. */
export function Breadcrumb({ className, children, ...props }: BreadcrumbProps) {
  const id = useId();
  return (
    <nav aria-label="Breadcrumb" {...props} className={cn("min-w-0", className)}>
      <LayoutGroup id={id}>{children}</LayoutGroup>
    </nav>
  );
}

export type BreadcrumbListProps = ComponentPropsWithRef<"ol"> & {
  /** Maximum visible slots, including the ellipsis. At least 3. */
  maxItems?: number;
};

/** Pass keyed BreadcrumbItems directly so entering and leaving routes animate. */
export function BreadcrumbList({ className, children, maxItems = 4, ...props }: BreadcrumbListProps) {
  const items = Children.toArray(children);
  const tailCount = maxItems - 2;
  const visible = items.length > maxItems ? [
    items[0],
    <BreadcrumbItem key="breadcrumb-overflow">
      <BreadcrumbSeparator />
      <BreadcrumbEllipsis>{items.slice(1, -tailCount)}</BreadcrumbEllipsis>
    </BreadcrumbItem>,
    ...items.slice(-tailCount),
  ] : items;
  return (
    <ol
      {...props}
      className={cn("relative flex flex-wrap items-center gap-x-1 gap-y-1 text-sm", className)}
    >
      <AnimatePresence initial={false} mode="popLayout">{visible}</AnimatePresence>
    </ol>
  );
}

export type BreadcrumbItemProps = HTMLMotionProps<"li">;

/** Use a stable route key; put its optional separator inside this item. */
export const BreadcrumbItem = forwardRef<HTMLLIElement, BreadcrumbItemProps>(
  function BreadcrumbItem({ className, style, children, ...props }, ref) {
    const reduce = useReducedMotion();
    const present = useIsPresent();
    const itemRef = useRef<HTMLLIElement>(null);
    useLayoutEffect(() => {
      const item = itemRef.current;
      if (!item || !present) return;
      const measure = () => {
        // popLayout snapshots offsetWidth (integer pixels). Retain the exact
        // width so a fractional-pixel loss cannot wrap the final character.
        item.style.setProperty("--breadcrumb-exit-width", `${item.getBoundingClientRect().width}px`);
      };
      measure();
      const observer = new ResizeObserver(measure);
      observer.observe(item);
      return () => observer.disconnect();
    }, [present]);
    const hidden = { opacity: 0, y: reduce ? 0 : 6 };
    return (
      <motion.li
        ref={(node) => {
          itemRef.current = node;
          if (typeof ref === "function") return ref(node);
          if (ref) ref.current = node;
        }}
        layout={reduce ? false : "position"}
        initial={hidden}
        animate={{ opacity: 1, y: 0 }}
        exit={hidden}
        transition={{ duration: 0.2, ease: EASE_OUT, layout: SPRING_LAYOUT }}
        {...props}
        inert={!present}
        aria-hidden={!present || undefined}
        style={{
          ...style,
          minWidth: present ? style?.minWidth : "var(--breadcrumb-exit-width)",
          pointerEvents: present ? style?.pointerEvents : "none",
        }}
        className={cn("relative inline-flex min-w-0 max-w-full items-center gap-1", className)}
      >
        {children}
      </motion.li>
    );
  },
);

export type BreadcrumbLinkProps = ComponentProps<typeof Link>;

export function BreadcrumbLink({ className, ...props }: BreadcrumbLinkProps) {
  return (
    <Link
      {...props}
      className={cn(
        "inline-flex min-h-8 min-w-0 items-center gap-1.5 rounded-md px-2 font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&>svg]:size-3.5 [&>svg]:shrink-0",
        className,
      )}
    />
  );
}

export type BreadcrumbPageProps = ComponentPropsWithRef<"span">;

export function BreadcrumbPage({ className, children, ...props }: BreadcrumbPageProps) {
  return (
    <span
      {...props}
      aria-current="page"
      className={cn(
        "relative isolate inline-flex min-h-8 min-w-0 items-center gap-1.5 rounded-md px-2 font-medium text-foreground [overflow-wrap:anywhere] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&>svg]:size-3.5 [&>svg]:shrink-0",
        className,
      )}
    >
      {children}
    </span>
  );
}

export type BreadcrumbSeparatorProps = Omit<ComponentPropsWithRef<"span">, "children">;

/** Decorative separator, placed inside the following BreadcrumbItem. */
export function BreadcrumbSeparator({ className, ...props }: BreadcrumbSeparatorProps) {
  return (
    <span
      {...props}
      aria-hidden="true"
      data-breadcrumb-separator=""
      className={cn("inline-flex shrink-0 items-center text-muted-foreground/50 [&>svg]:size-3.5 rtl:rotate-180", className)}
    >
      <ChevronRight />
    </span>
  );
}


/**
 * The hidden ancestors behind an ellipsis. Hover opens it on a mouse, a press
 * toggles it anywhere, and opening it from the keyboard focuses the first link.
 */
function BreadcrumbEllipsis({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  // An ellipsis leaving the trail (popLayout keeps it mounted while it fades)
  // must not hold its panel open over the page that replaced it.
  const present = useIsPresent();
  return (
    <Popover open={open && present} onOpenChange={setOpen}>
      <PopoverTrigger
        openOnHover
        delay={0}
        closeDelay={160}
        aria-label="Show hidden paths"
        className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Ellipsis aria-hidden="true" className="size-4" />
      </PopoverTrigger>
      <PopoverContent className="w-56 max-w-(--available-width) p-1.5">
        <ol
          // Following a link navigates without unmounting the trail, so close
          // the panel here rather than leaving it over the new page.
          onClick={(event) => {
            if ((event.target as Element).closest("a[href]")) setOpen(false);
          }}
          className="flex max-h-64 flex-col gap-0.5 overflow-y-auto [&>li]:w-full [&_a]:w-full [&_a]:py-1 [&_a]:[overflow-wrap:anywhere] [&_[data-breadcrumb-separator]]:hidden"
        >
          {children}
        </ol>
      </PopoverContent>
    </Popover>
  );
}
