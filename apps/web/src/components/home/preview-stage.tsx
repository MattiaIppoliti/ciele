"use client";

import { useRef, type CSSProperties, type ReactNode } from "react";
import {
  AmbientActiveContext,
  useShouldAnimate,
} from "@/components/home/use-in-viewport";

/* Wraps the hero's tilted product-preview region. It observes its OWN
   (non-transformed) box for viewport visibility + reduced-motion and hands
   the resulting "should the mock animate?" decision to the mock inside via
   AmbientActiveContext: the mock can't observe itself because it lives
   inside a 3D-transformed plane. A plain passthrough div otherwise, so the
   existing #preview styling/layout is unchanged. */
export function PreviewStage({
  children,
  id,
  className,
  style,
}: {
  children: ReactNode;
  id?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const active = useShouldAnimate(ref);
  return (
    <div ref={ref} id={id} className={className} style={style}>
      <AmbientActiveContext.Provider value={active}>
        {children}
      </AmbientActiveContext.Provider>
    </div>
  );
}
