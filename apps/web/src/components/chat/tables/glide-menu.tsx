"use client";

import { useRef, useState, type ReactNode } from "react";

/** The supplied table's menu-row API; the highlight follows pointer and keyboard focus. */
export default function GlideMenu({
  children,
  className = "",
  highlightClassName = "rounded-[8px] bg-hover",
}: {
  children: ReactNode;
  className?: string;
  highlightClassName?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [highlight, setHighlight] = useState<{
    top: number;
    height: number;
  } | null>(null);
  function follow(target: EventTarget | null) {
    const row =
      target instanceof Element
        ? target.closest<HTMLElement>("[data-menu-row]")
        : null;
    if (!row || !root.current) return;
    setHighlight({ top: row.offsetTop, height: row.offsetHeight });
  }
  return (
    <div
      ref={root}
      className={`relative ${className}`}
      onPointerMove={(event) => follow(event.target)}
      onFocusCapture={(event) => follow(event.target)}
      onPointerLeave={() => setHighlight(null)}
      onKeyDown={(event) => {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
          return;
        const rows = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>(
            "[data-menu-row]:not(:disabled)",
          ),
        );
        if (!rows.length) return;
        event.preventDefault();
        const index = rows.findIndex((row) => row === document.activeElement);
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? rows.length - 1
              : index < 0
                ? event.key === "ArrowDown"
                  ? 0
                  : rows.length - 1
                : (index + (event.key === "ArrowDown" ? 1 : -1) + rows.length) %
                  rows.length;
        rows[next]?.focus();
      }}
    >
      {highlight && (
        <span
          aria-hidden
          className={`pointer-events-none absolute inset-x-0 transition-[top,height] duration-150 motion-reduce:transition-none ${highlightClassName}`}
          style={highlight}
        />
      )}
      {children}
    </div>
  );
}
