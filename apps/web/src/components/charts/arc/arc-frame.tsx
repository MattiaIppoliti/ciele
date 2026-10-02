import type { ReactNode } from "react";
import "./theme.css";

/** Isolates Arc's CSS variables from Ciele controls and the page shell. */
export function ArcFrame({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`arc-charts ${className}`}>{children}</div>;
}
