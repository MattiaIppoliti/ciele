/** Card appearance tokens, orthogonal to dot sections. */
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
}

/** The one card appearance in use (light). */
export const APPEARANCE: AppearanceTokens = {
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
  idleDot: "rgba(18,18,18,0.08)",
  hoverDot: "rgba(18,18,18,0.04)",
  primaryLineStroke: "rgba(18,18,18,0.85)",
  compareLineStroke: "rgba(18,18,18,0.4)",
  compareLineFill: "rgba(18,18,18,0.06)",
  switchTrackOff: "bg-[#e5e5ea]",
};
