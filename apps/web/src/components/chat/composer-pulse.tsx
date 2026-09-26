"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createBorderBeamStyles } from "./border-beam/styles";
import { useRenderedTheme } from "./use-rendered-theme";

/** The original BorderBeam md / Rotate effect, active only during generation. */
export function ComposerPulse({
  children,
  loading,
}: {
  children: ReactNode;
  loading: boolean;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const id = `composer-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const resolvedTheme = useRenderedTheme();
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const observer = new IntersectionObserver(([entry]) => {
      setVisible(entry.isIntersecting);
    });
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, []);

  const css = useMemo(
    () => createBorderBeamStyles(id, resolvedTheme),
    [id, resolvedTheme],
  );

  return (
    <>
      <style>{css}</style>
      {/* The beam is an overlay beside the composer, not a wrapper around it:
          its box is `overflow: hidden`, and wrapping the composer cut off the
          model picker, which opens upward out of it. Every beam layer already
          clips itself with `clip-path`, so the overlay draws the same glow.
          The overlay isolates itself, not the wrapper: its z-indexed layers
          stay inside it, while the picker keeps competing with the thread
          above (an isolated wrapper put it under "Contact support"). */}
      <div ref={wrapperRef} className="relative w-full">
        {children}
        <div
          // Inline, because the beam's own unlayered `position: relative`
          // outranks a Tailwind utility.
          style={{ position: "absolute", inset: 0, pointerEvents: "none", isolation: "isolate" }}
          data-beam={id}
          data-active={loading ? "" : undefined}
          data-paused={!visible ? "" : undefined}
          aria-hidden="true"
        >
          <div data-beam-bloom="" />
        </div>
      </div>
    </>
  );
}
