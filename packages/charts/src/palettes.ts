import type { DotSection } from "./types";

/**
 * Dot color presets for the DotChart. Pass via the `sections` prop.
 * `navy` matches the ciele brand-navy used across both consoles and is the
 * default for admin dashboards; the rest come from the reference design.
 */
export const PALETTES = {
  navy: [
    {
      start: 0,
      end: 1,
      palette: {
        filled: "rgba(38,46,92,0.55)",
        active: "#3c477e",
        topDot: "#1d2450",
      },
    },
  ],
  pastel: [
    {
      start: 0,
      end: 0.33,
      label: "Launch",
      palette: {
        filled: "rgba(249,168,212,0.72)",
        active: "#f472b6",
        topDot: "#ec4899",
      },
    },
    {
      start: 0.33,
      end: 0.66,
      label: "Scale",
      palette: {
        filled: "rgba(253,186,116,0.72)",
        active: "#fb923c",
        topDot: "#f97316",
      },
    },
    {
      start: 0.66,
      end: 1,
      label: "Peak",
      palette: {
        filled: "rgba(147,197,253,0.72)",
        active: "#60a5fa",
        topDot: "#3b82f6",
      },
    },
  ],
  darkPastel: [
    {
      start: 0,
      end: 0.33,
      label: "Launch",
      palette: {
        filled: "rgba(244,114,182,0.55)",
        active: "#f9a8d4",
        topDot: "#fce7f3",
      },
    },
    {
      start: 0.33,
      end: 0.66,
      label: "Scale",
      palette: {
        filled: "rgba(251,146,60,0.6)",
        active: "#fdba74",
        topDot: "#ffedd5",
      },
    },
    {
      start: 0.66,
      end: 1,
      label: "Peak",
      palette: {
        filled: "rgba(96,165,250,0.6)",
        active: "#93c5fd",
        topDot: "#dbeafe",
      },
    },
  ],
  emerald: [
    {
      start: 0,
      end: 1,
      palette: {
        filled: "rgba(52,211,153,0.5)",
        active: "#34d399",
        topDot: "#10b981",
      },
    },
  ],
  warm: [
    {
      start: 0,
      end: 0.5,
      label: "Build",
      palette: {
        filled: "rgba(252,211,77,0.7)",
        active: "#fbbf24",
        topDot: "#f59e0b",
      },
    },
    {
      start: 0.5,
      end: 1,
      label: "Ignite",
      palette: {
        filled: "rgba(251,146,60,0.72)",
        active: "#fb923c",
        topDot: "#ea580c",
      },
    },
  ],
  cool: [
    {
      start: 0,
      end: 0.5,
      label: "Plan",
      palette: {
        filled: "rgba(129,140,248,0.65)",
        active: "#818cf8",
        topDot: "#6366f1",
      },
    },
    {
      start: 0.5,
      end: 1,
      label: "Execute",
      palette: {
        filled: "rgba(125,211,252,0.7)",
        active: "#38bdf8",
        topDot: "#0ea5e9",
      },
    },
  ],
  monochrome: [
    {
      start: 0,
      end: 1,
      palette: {
        filled: "rgba(82,82,91,0.5)",
        active: "#52525b",
        topDot: "#18181b",
      },
    },
  ],
} as const satisfies Record<string, readonly DotSection[]>;

export type PaletteName = keyof typeof PALETTES;
