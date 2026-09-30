"use client";

import { cn } from "@/lib/utils";
import {
  autoUpdate,
  computePosition,
  flip,
  offset,
  shift,
} from "@floating-ui/dom";
import { ArrowUpRight, Globe } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Adapted from https://smoothui.dev/docs/components/ai-citation.
/** Grace period so the pointer can cross the gap between pill and card. */
const CLOSE_DELAY_MS = 120;
const CARD_WIDTH_PX = 288;

export type AICitationProps = {
  className?: string;
  /** Excerpt or description shown in the card. */
  description?: ReactNode;
  /**
   * The source's mark for the card header — a real isotype or an `<img>`.
   *
   * A node rather than a URL so a brand's own SVG can be passed straight in.
   */
  favicon?: ReactNode;
  /** The number or short label shown in the pill. */
  label: string | number;
  title: ReactNode;
  /** A private document still has a preview, but no fabricated external link. */
  url?: string;
};

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/**
 * An inline citation that can be peeked at.
 *
 * The card scales up **from the pill** rather than fading in centred: with a
 * transform origin at the bottom of the marker, the growth points back at what
 * was clicked, so the pointer never loses the thread. It opens on hover and on
 * focus, and closes on Escape — a hover-only preview is unreachable by keyboard
 * and unusable on touch.
 */
const AICitation = ({
  className,
  description,
  favicon,
  label,
  title,
  url,
}: AICitationProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const cardId = useId();
  const triggerRef = useRef<HTMLSpanElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const safeUrl = (() => {
    if (!url) return undefined;
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:" || parsed.protocol === "http:"
        ? url
        : undefined;
    } catch {
      return undefined;
    }
  })();

  const open = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    setIsOpen(true);
  };

  const scheduleClose = () => {
    if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    closeTimeoutRef.current = setTimeout(
      () => setIsOpen(false),
      CLOSE_DELAY_MS,
    );
  };

  // A portal keeps the card out of Preview's scroll clipping. Reposition it
  // while the rail resizes or the transcript scrolls, and flip at the edge.
  useEffect(() => {
    const trigger = triggerRef.current;
    const card = cardRef.current;
    if (!isOpen || !trigger || !card) return;
    let active = true;
    const cleanup = autoUpdate(trigger, card, () => {
      void computePosition(trigger, card, {
        strategy: "fixed",
        placement: "top",
        middleware: [offset(6), flip(), shift({ padding: 8 })],
      }).then(({ x, y, placement }) => {
        if (!active) return;
        Object.assign(card.style, {
          left: `${x}px`,
          top: `${y}px`,
          visibility: "visible",
        });
        card.style.setProperty(
          "--citation-origin",
          placement.startsWith("top") ? "bottom center" : "top center",
        );
      });
    });
    return () => {
      active = false;
      cleanup();
    };
  }, [isOpen]);

  useEffect(
    () => () => {
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handle = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
        setIsOpen(false);
      }
    };
    const dismissOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !triggerRef.current?.contains(event.target) &&
        !cardRef.current?.contains(event.target)
      ) {
        setIsOpen(false);
      }
    };
    window.addEventListener("keydown", handle);
    document.addEventListener("pointerdown", dismissOutside);
    return () => {
      window.removeEventListener("keydown", handle);
      document.removeEventListener("pointerdown", dismissOutside);
    };
  }, [isOpen]);

  const triggerClassName =
    "press-text inline-flex size-3.5 shrink-0 items-center justify-center rounded-full border border-alpha-medium bg-alpha-light p-0 text-2xs leading-none font-medium tabular-nums text-muted-foreground no-underline! transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <span
      ref={triggerRef}
      data-slot="ai-citation"
      className={cn("relative inline-block align-super", className)}
      onBlur={scheduleClose}
      onFocus={open}
      onMouseEnter={open}
      onMouseLeave={scheduleClose}
    >
      {safeUrl ? (
        <a
          aria-label={`Source ${label}: ${typeof title === "string" ? title : label}`}
          aria-describedby={isOpen ? cardId : undefined}
          className={triggerClassName}
          href={safeUrl}
          rel="noopener noreferrer"
          target="_blank"
        >
          {label}
        </a>
      ) : (
        <button
          type="button"
          aria-label={`Source ${label}: ${typeof title === "string" ? title : label}`}
          aria-describedby={isOpen ? cardId : undefined}
          aria-expanded={isOpen}
          className={triggerClassName}
          onClick={open}
        >
          {label}
        </button>
      )}

      {typeof document !== "undefined"
        ? createPortal(
            isOpen ? (
              <div
                ref={cardRef}
                style={{
                  position: "fixed",
                  top: 0,
                  left: 0,
                  visibility: "hidden",
                  width: CARD_WIDTH_PX,
                  maxWidth: "calc(100vw - 16px)",
                }}
                className="z-[100]"
                onMouseEnter={open}
                onMouseLeave={scheduleClose}
              >
                <span
                  className="block rounded-xl border border-alpha-medium bg-popover p-3 text-left align-baseline shadow-strong animate-in fade-in zoom-in-95 duration-150 motion-reduce:animate-none"
                  id={cardId}
                  role="tooltip"
                  style={{
                    // Origin at the bottom centre — where the pill is — so the card
                    // grows out of the marker instead of appearing over it.
                    transformOrigin: "var(--citation-origin, bottom center)",
                  }}
                >
                  <span className="mb-1 flex items-center gap-1.5">
                    <span className="flex size-3.5 shrink-0 items-center justify-center overflow-hidden rounded-sm text-muted-foreground *:size-full *:object-cover">
                      {favicon ?? <Globe aria-hidden="true" size={11} />}
                    </span>
                    <span className="truncate text-muted-foreground text-xs">
                      {safeUrl ? hostOf(safeUrl) : "Knowledge"}
                    </span>
                    {safeUrl ? (
                      <ArrowUpRight
                        aria-hidden="true"
                        className="ml-auto text-muted-foreground"
                        size={12}
                      />
                    ) : null}
                  </span>

                  <span className="block font-medium text-foreground text-sm leading-snug">
                    {title}
                  </span>

                  {description ? (
                    <span className="mt-1 block text-muted-foreground text-xs leading-relaxed">
                      {description}
                    </span>
                  ) : null}
                </span>
              </div>
            ) : null,
            document.body,
          )
        : null}
    </span>
  );
};

export default AICitation;
