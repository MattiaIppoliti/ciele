import { CHART_OUTCOMES, CHART_SERIES } from "@/components/charts/palette";

// Keep the same series identity in both themes; CSS resolves each token.
type Pair = { light: string; dark: string };
const pair = (color: string): Pair => ({ light: color, dark: color });

export const SURFACE_COLORS: Record<"assistants" | "teammates" | "internal" | "unattributed", Pair> = {
  assistants: pair(CHART_SERIES[0]),
  teammates: pair(CHART_SERIES[2]),
  internal: pair(CHART_SERIES[4]),
  unattributed: pair(CHART_SERIES[1]),
};

export const OUTCOME_COLORS: Record<"good" | "bad", Pair> = {
  good: pair(CHART_OUTCOMES.positive),
  bad: pair(CHART_OUTCOMES.negative),
};

export const SINGLE_SERIES: Pair = pair(CHART_SERIES[0]);
export const RANK_COLORS = CHART_SERIES;

export const SURFACE_LABELS = {
  assistants: "Assistants",
  teammates: "Teammates",
  internal: "Internal",
  unattributed: "Unattributed",
} as const;
