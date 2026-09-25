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
      <div
        ref={wrapperRef}
        className="isolate w-full"
        data-beam={id}
        data-active={loading ? "" : undefined}
        data-paused={!visible ? "" : undefined}
      >
        {children}
        <div data-beam-bloom="" aria-hidden="true" />
      </div>
    </>
  );
}
