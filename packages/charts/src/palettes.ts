import type { DotSection } from "./types";

/**
 * Dot color sections for the DotChart. `navy` matches the ciele brand-navy
 * used across both consoles and is the palette for admin dashboards.
 */
export const NAVY_SECTIONS: readonly DotSection[] = [
  {
    start: 0,
    end: 1,
    palette: {
      filled: "rgba(38,46,92,0.55)",
      active: "#3c477e",
      topDot: "#1d2450",
    },
  },
];
