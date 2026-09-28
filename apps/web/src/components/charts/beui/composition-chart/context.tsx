"use client";
// Vendored from beui, trimmed to what Ciele's callers use.

import { createContext, useContext, useMemo, useState } from "react";
import { useReducedMotion } from "motion/react";
import { useHoverCapable } from "@/lib/hooks/use-hover-capable";
import { buildComposition, type CompositionSeries } from "./model";

export interface CompositionChartProps {
  series: readonly CompositionSeries[];
  /** Unique labels in chronological order. */
  periods: readonly string[];
  formatValue: (value: number) => string;
  label?: string;
  className?: string;
}

export function useCompositionModel({
  series,
  periods,
  formatValue,
  label = "Composition over time",
}: CompositionChartProps) {
  const model = useMemo(() => buildComposition(series, periods), [series, periods]);
  const [internal, setInternal] = useState<string | undefined>(undefined);
  const [pinned, setPinned] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const validSeries = (id: string | null) => model.rows.some((row) => row.id === id);
  if (internal !== undefined && !model.columns.some((column) => column.id === internal))
    setInternal(undefined);
  if (pinned !== null && !validSeries(pinned)) setPinned(null);
  if (hovered !== null && !validSeries(hovered)) setHovered(null);
  if (focused !== null && !validSeries(focused)) setFocused(null);
  const found = model.columns.findIndex((column) => column.id === internal);
  const index = found >= 0 ? found : model.columns.length - 1;
  const highlight = [hovered, focused, pinned].find((id) => id !== null && validSeries(id)) ?? null;
  return {
    ...model,
    index,
    column: model.columns[index],
    select: setInternal,
    label,
    formatValue,
    pinned,
    setPinned,
    highlight,
    setHovered,
    setFocused,
    reduce: useReducedMotion(),
    canHover: useHoverCapable(),
  };
}

export const CompositionContext = createContext<ReturnType<typeof useCompositionModel> | null>(
  null,
);
export function useCompositionChart() {
  const context = useContext(CompositionContext);
  if (!context)
    throw new Error("Composition chart parts must be rendered inside CompositionChart.");
  return context;
}
