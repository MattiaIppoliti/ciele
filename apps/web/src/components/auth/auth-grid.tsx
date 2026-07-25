"use client";

import { useEffect, useRef, useState } from "react";

type AuthGridProps = {
  tone: "light" | "dark";
};

/**
 * Slowly scrolling grid with a cursor-following highlight. Keeping the
 * interaction in this leaf client component lets the auth pages remain server
 * rendered while restoring the original grid treatment on both panels.
 */
export function AuthGrid({ tone }: AuthGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState({ x: -320, y: -320 });
  const isDark = tone === "dark";
  const gridImage = isDark
    ? "linear-gradient(to right, rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.05) 1px, transparent 1px)"
    : "linear-gradient(to right, rgba(0,0,0,0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,0,0,0.05) 1px, transparent 1px)";
  const highlightImage = isDark
    ? "linear-gradient(to right, rgba(255,255,255,0.3) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.3) 1px, transparent 1px)"
    : "linear-gradient(to right, rgba(0,0,0,0.3) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,0,0,0.3) 1px, transparent 1px)";

  useEffect(() => {
    const container = gridRef.current?.parentElement;
    if (!container) return;

    const handlePointerMove = (event: PointerEvent) => {
      const bounds = container.getBoundingClientRect();
      setCursor({ x: event.clientX - bounds.left, y: event.clientY - bounds.top });
    };
    const clearCursor = () => setCursor({ x: -320, y: -320 });

    container.addEventListener("pointermove", handlePointerMove);
    container.addEventListener("pointerleave", clearCursor);
    return () => {
      container.removeEventListener("pointermove", handlePointerMove);
      container.removeEventListener("pointerleave", clearCursor);
    };
  }, []);

  return (
    <div ref={gridRef} aria-hidden="true" className="auth-grid pointer-events-none absolute inset-0">
      <div
        className="auth-grid-layer absolute inset-0"
        style={{ backgroundImage: gridImage }}
      />
      <div
        className="auth-grid-layer absolute inset-0"
        style={{
          backgroundImage: highlightImage,
          maskImage: `radial-gradient(300px circle at ${cursor.x}px ${cursor.y}px, black, transparent)`,
          WebkitMaskImage: `radial-gradient(300px circle at ${cursor.x}px ${cursor.y}px, black, transparent)`,
        }}
      />
    </div>
  );
}
