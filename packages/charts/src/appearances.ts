import type { CardAppearance } from "./types";

/** Card appearance tokens — orthogonal to dot sections. */
export interface AppearanceTokens {
  card: string;
  glow: string;
  gridLineColor: string;
  text: string;
  subtext: string;
  iconBg: string;
  iconFg: string;
  trendBorder: string;
  trendBg: string;
  trendText: string;
  trendDownBorder: string;
  trendDownBg: string;
  trendDownText: string;
  dashedLine: string;
  tooltipBg: string;
  tooltipText: string;
  tooltipSub: string;
  tooltipShadow: string;
  skeletonDot: string;
  idleDot: string;
  hoverDot: string;
  /** Stroke color of the primary (current) series polyline overlay */
  primaryLineStroke: string;
  /** Stroke color of the compare (previous) series polyline overlay */
  compareLineStroke: string;
  /** Fill color of the compare series area below the line */
  compareLineFill: string;
  /** Switch track background when inactive */
  switchTrackOff: string;
  focusRing: string;
  retryButton: string;
}

export const APPEARANCES: Record<CardAppearance, AppearanceTokens> = {
  light: {
    card: "bg-card border border-border shadow-[0_8px_32px_rgba(18,18,18,0.06)]",
    glow: "bg-indigo-200/50",
    gridLineColor: "rgba(18,18,18,0.7)",
    text: "text-foreground",
    subtext: "text-muted-foreground",
    iconBg: "bg-muted",
    iconFg: "text-foreground",
    trendBorder: "border-emerald-500/40",
    trendBg: "bg-emerald-500/10",
    trendText: "text-emerald-600",
    trendDownBorder: "border-rose-500/40",
    trendDownBg: "bg-rose-500/10",
    trendDownText: "text-rose-600",
    dashedLine: "border-foreground/20",
    tooltipBg: "bg-[#121212]",
    tooltipText: "text-white",
    tooltipSub: "text-zinc-400",
    tooltipShadow: "shadow-lg shadow-[#121212]/15",
    skeletonDot: "rgba(18,18,18,0.12)",
    idleDot: "rgba(18,18,18,0.08)",
    hoverDot: "rgba(18,18,18,0.04)",
    primaryLineStroke: "rgba(18,18,18,0.85)",
    compareLineStroke: "rgba(18,18,18,0.4)",
    compareLineFill: "rgba(18,18,18,0.06)",
    switchTrackOff: "bg-[#e5e5ea]",
    focusRing:
      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
    retryButton:
      "bg-[#121212] text-white hover:bg-[#2a2a2a] active:scale-[0.97]",
  },
  dark: {
    card: "bg-[#0b0b0f] border border-white/5 shadow-[0_12px_40px_rgba(0,0,0,0.45)]",
    glow: "bg-pink-400/40",
    gridLineColor: "rgba(255,255,255,0.55)",
    text: "text-white",
    subtext: "text-zinc-400",
    iconBg: "bg-white/10",
    iconFg: "text-white",
    trendBorder: "border-blue-300/40",
    trendBg: "bg-blue-400/15",
    trendText: "text-blue-200",
    trendDownBorder: "border-rose-300/40",
    trendDownBg: "bg-rose-400/15",
    trendDownText: "text-rose-200",
    dashedLine: "border-white/20",
    tooltipBg: "bg-white",
    tooltipText: "text-[#121212]",
    tooltipSub: "text-zinc-500",
    tooltipShadow: "shadow-[0_8px_32px_rgba(0,0,0,0.6)]",
    skeletonDot: "rgba(255,255,255,0.22)",
    idleDot: "rgba(255,255,255,0.09)",
    hoverDot: "rgba(255,255,255,0.05)",
    primaryLineStroke: "rgba(255,255,255,0.95)",
    compareLineStroke: "rgba(255,255,255,0.45)",
    compareLineFill: "rgba(255,255,255,0.06)",
    switchTrackOff: "bg-white/15",
    focusRing:
      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300",
    retryButton: "bg-white text-zinc-900 hover:bg-zinc-200 active:scale-[0.97]",
  },
  pastel: {
    card: "bg-[#f8f7f7] border border-[#ececec] shadow-[0_12px_40px_rgba(18,18,18,0.08)]",
    glow: "bg-blue-200/70",
    gridLineColor: "rgba(18,18,18,0.5)",
    text: "text-[#121212]",
    subtext: "text-[#7b7b7b]",
    iconBg: "bg-yellow-100",
    iconFg: "text-zinc-800",
    trendBorder: "border-blue-300/60",
    trendBg: "bg-blue-100",
    trendText: "text-blue-600",
    trendDownBorder: "border-rose-300/60",
    trendDownBg: "bg-rose-100",
    trendDownText: "text-rose-600",
    dashedLine: "border-[#121212]/15",
    tooltipBg: "bg-[#121212]",
    tooltipText: "text-white",
    tooltipSub: "text-zinc-400",
    tooltipShadow: "shadow-lg shadow-[#121212]/10",
    skeletonDot: "rgba(18,18,18,0.12)",
    idleDot: "rgba(18,18,18,0.08)",
    hoverDot: "rgba(18,18,18,0.04)",
    primaryLineStroke: "rgba(18,18,18,0.85)",
    compareLineStroke: "rgba(18,18,18,0.4)",
    compareLineFill: "rgba(18,18,18,0.06)",
    switchTrackOff: "bg-[#e5e5ea]",
    focusRing:
      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500",
    retryButton:
      "bg-[#121212] text-white hover:bg-[#2a2a2a] active:scale-[0.97]",
  },
};
