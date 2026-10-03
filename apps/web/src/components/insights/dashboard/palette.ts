import { CHART_OUTCOMES, CHART_SERIES } from "@/components/charts/palette";

export const SURFACE_COLORS: Record<"assistants" | "teammates" | "internal" | "unattributed", string> = {
  assistants: CHART_SERIES[0],
  teammates: CHART_SERIES[2],
  internal: CHART_SERIES[4],
  unattributed: CHART_SERIES[1],
};

export const OUTCOME_COLORS: Record<"good" | "bad", string> = {
  good: CHART_OUTCOMES.positive,
  bad: CHART_OUTCOMES.negative,
};

export const RANK_COLORS = CHART_SERIES;

export const SURFACE_LABELS = {
  assistants: "Assistants",
  teammates: "Teammates",
  internal: "Internal",
  unattributed: "Unattributed",
} as const;
