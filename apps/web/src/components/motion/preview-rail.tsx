"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useId, useState, type ReactNode } from "react";
import { EASE_OUT, SPRING_LAYOUT } from "@/lib/ease";
import { useHoverCapable } from "@/lib/hooks/use-hover-capable";
import { cn } from "@/lib/utils";

export interface PreviewRailItem {
  id: string;
  label: string;
  ariaLabel?: string;
  description?: ReactNode;
  href?: string;
}

export interface PreviewRailProps {
  items: PreviewRailItem[];
  label?: string;
  activeId: string;
  onActiveChange?: (id: string) => void;
  onItemSelect?: (item: PreviewRailItem) => void;
  previewSide?: "before" | "after";
  highlightActive?: boolean;
  itemSize?: number;
  children?: ReactNode;
  className?: string;
  railClassName?: string;
  previewContainerClassName?: string;
  previewClassName?: string;
}

function DefaultPreview({ item }: { item: PreviewRailItem }) {
  return (
    <div
      data-slot="preview-rail-card"
      className="rounded-2xl border border-border bg-card p-4 shadow-sm"
    >
      <p
        data-slot="preview-rail-title"
        className="font-medium text-card-foreground"
      >
        {item.label}
      </p>
      {item.description ? (
        <div
          data-slot="preview-rail-description"
          className="mt-1 text-sm leading-6 text-muted-foreground"
        >
          {item.description}
        </div>
      ) : null}
    </div>
  );
}

export function PreviewRail({
  items,
  label = "Section navigation",
  activeId,
  onActiveChange,
  onItemSelect,
  previewSide = "after",
  highlightActive = false,
  itemSize = 24,
  children,
  className,
  railClassName,
  previewContainerClassName,
  previewClassName,
}: PreviewRailProps) {
  const uid = useId();
  const reduce = useReducedMotion();
  const canHover = useHoverCapable();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const selectedId = items.some((item) => item.id === activeId)
    ? activeId
    : (items[0]?.id ?? "");
  const displayedId = hoveredId ?? focusedId ?? "";
  const highlightedId = displayedId || (highlightActive ? selectedId : "");
  const displayedIndex = items.findIndex((item) => item.id === highlightedId);
  const rowTemplate = items.length
    ? `repeat(${items.length}, ${itemSize}px)`
    : undefined;

  return (
    <motion.div
      layoutRoot
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setFocusedId(null);
        }
      }}
      className={cn(
        "isolate relative flex w-full overflow-visible min-h-80",
        className,
      )}
    >
      <nav
        aria-label={label}
        onPointerLeave={() => setHoveredId(null)}
        style={{ gridTemplateRows: rowTemplate }}
        className={cn(
          "relative z-10 grid shrink-0 w-12 content-center",
          railClassName,
        )}
      >
        {items.map((item, index) => {
          const selected = item.id === selectedId;
          const highlighted = item.id === highlightedId;
          const distance =
            displayedIndex < 0 ? Number.POSITIVE_INFINITY : Math.abs(index - displayedIndex);
          const scale = highlighted
            ? 1
            : distance === 1
              ? 0.68
              : distance === 2
                ? 0.44
                : 0.25;

          const itemContent = (
            <>
              <motion.span
                data-slot="preview-rail-tick"
                aria-hidden="true"
                animate={{ scaleX: scale }}
                transition={reduce ? { duration: 0 } : SPRING_LAYOUT}
                className={cn(
                  "block bg-current h-0.5 w-12 origin-left",
                  highlighted ? "text-foreground" : undefined,
                )}
              />
            </>
          );

          const sharedClassName = cn(
            "relative flex text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            "h-6 w-12 items-center",
          );
          const sharedStyle = { height: itemSize };
          const handlePointerEnter = () => {
            if (canHover) setHoveredId(item.id);
          };
          const handleFocus = (currentTarget: HTMLElement) => {
            if (currentTarget.matches(":focus-visible")) {
              setFocusedId(item.id);
            }
          };
          const handleSelect = () => {
            onActiveChange?.(item.id);
            onItemSelect?.(item);
          };

          return item.href ? (
            <a
              key={item.id}
              data-slot="preview-rail-item"
              href={item.href}
              aria-label={item.ariaLabel ?? item.label}
              aria-current={selected ? "page" : undefined}
              onPointerEnter={handlePointerEnter}
              onMouseEnter={handlePointerEnter}
              onPointerDown={() => setFocusedId(null)}
              onFocus={(event) => handleFocus(event.currentTarget)}
              onClick={handleSelect}
              style={sharedStyle}
              className={sharedClassName}
            >
              {itemContent}
            </a>
          ) : (
            <button
              key={item.id}
              data-slot="preview-rail-item"
              type="button"
              aria-label={item.ariaLabel ?? item.label}
              aria-current={selected ? "location" : undefined}
              onPointerEnter={handlePointerEnter}
              onMouseEnter={handlePointerEnter}
              onPointerDown={() => setFocusedId(null)}
              onFocus={(event) => handleFocus(event.currentTarget)}
              onClick={handleSelect}
              style={sharedStyle}
              className={sharedClassName}
            >
              {itemContent}
            </button>
          );
        })}
      </nav>

      <div
        aria-hidden="true"
        style={{ gridTemplateRows: rowTemplate }}
        className={cn(
          "pointer-events-none absolute z-50 grid",
          previewSide === "before"
            ? "inset-y-0 right-16 left-4 content-center"
            : "inset-y-0 right-4 left-16 content-center",
          previewContainerClassName,
        )}
      >
        {items.map((item) => (
          <div
            key={item.id}
            style={{ height: itemSize }}
            className="relative flex items-center"
          >
            {item.id === displayedId ? (
              <div
                className={cn(
                  "w-full max-w-sm",
                  previewSide === "before" && "ml-auto",
                  previewClassName,
                )}
              >
                <motion.div
                  layoutId={`preview-rail-card-${uid}`}
                  transition={reduce ? { duration: 0 } : SPRING_LAYOUT}
                >
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.div
                      key={item.id}
                      initial={
                        reduce
                          ? { opacity: 0 }
                          : { opacity: 0, y: 4, filter: "blur(6px)" }
                      }
                      animate={
                        reduce
                          ? { opacity: 1 }
                          : { opacity: 1, y: 0, filter: "blur(0px)" }
                      }
                      exit={
                        reduce
                          ? { opacity: 0 }
                          : {
                              opacity: 0,
                              y: -2,
                              filter: "blur(4px)",
                              transition: {
                                duration: 0.12,
                                ease: EASE_OUT,
                              },
                            }
                      }
                      transition={{
                        duration: reduce ? 0 : 0.18,
                        ease: EASE_OUT,
                      }}
                    >
                      <DefaultPreview item={item} />
                    </motion.div>
                  </AnimatePresence>
                </motion.div>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {children ? (
        <div className="min-h-0 min-w-0 flex-1">{children}</div>
      ) : null}
    </motion.div>
  );
}
