/**
 * The Dashboard's colours, each validated with the dataviz palette checker in
 * both modes against the chart surfaces:
 *
 * - `SURFACE_COLORS`: categorical slots 1-3, which pass all-pairs (so a filter
 *   that hides a surface never needs the others repainted). Unattributed rows
 *   are the neutral "Other", not a fourth hue.
 * - `OUTCOME_COLORS`: blue for a turn that finished or an answer that passed,
 *   status-critical red for one that did not. Green against red fails the
 *   colour-blind separation check, so "good" is carried by blue here.
 * - `RANK_COLORS`: slots 1-5 in fixed order for the five Flow lines.
 */

type Pair = { light: string; dark: string };

export const SURFACE_COLORS: Record<"assistants" | "teammates" | "internal" | "unattributed", Pair> = {
  assistants: { light: "#2a78d6", dark: "#3987e5" },
  teammates: { light: "#eb6834", dark: "#d95926" },
  internal: { light: "#1baf7a", dark: "#199e70" },
  unattributed: { light: "#a1a1aa", dark: "#71717a" },
};

export const OUTCOME_COLORS: Record<"good" | "bad", Pair> = {
  good: { light: "#2a78d6", dark: "#3987e5" },
  bad: { light: "#d03b3b", dark: "#d03b3b" },
};

export const SINGLE_SERIES: Pair = { light: "#2a78d6", dark: "#3987e5" };

export const RANK_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"] as const;

export const SURFACE_LABELS = {
  assistants: "Assistants",
  teammates: "Teammates",
  internal: "Internal",
  unattributed: "Unattributed",
} as const;
