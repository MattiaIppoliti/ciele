"use client";

import { ArcFrame } from "@/components/charts/arc/arc-frame";
import { DonutChart } from "@/components/charts/arc/donut-chart/donut-chart";
import { Gauge } from "@/components/charts/arc/gauge/gauge";
import { WaffleChart } from "@/components/charts/arc/waffle-chart/waffle-chart";
import { formatCount } from "@/lib/format";
import { OUTCOME_COLORS } from "./palette";

export function RateDonut({
  good,
  bad,
  goodLabel,
  badLabel,
  title,
  loading,
  variant = "donut",
}: {
  good: number;
  bad: number;
  goodLabel: string;
  badLabel: string;
  title: string;
  loading: boolean;
  variant?: "donut" | "gauge" | "waffle";
}) {
  if (loading)
    return (
      <div
        aria-label="Loading chart"
        className="h-44 animate-pulse rounded-lg bg-muted/40"
      />
    );
  const total = good + bad;
  const data = [
    {
      key: "good",
      label: goodLabel,
      value: good,
      color: OUTCOME_COLORS.good,
    },
    {
      key: "bad",
      label: badLabel,
      value: bad,
      color: OUTCOME_COLORS.bad,
    },
  ];
  return (
    <ArcFrame>
      {variant === "gauge" ? (
        <div className="mx-auto max-w-56">
          <Gauge
            value={total ? (good / total) * 100 : 0}
            label={title}
            detail={`${formatCount(good)} ${goodLabel.toLowerCase()} · ${formatCount(bad)} ${badLabel.toLowerCase()}`}
            tone="success"
          />
        </div>
      ) : variant === "waffle" ? (
        <>
          <WaffleChart data={data} label={title} formatValue={formatCount} />
          <p className="mt-2 text-xs text-muted-foreground">
            {formatCount(good)} {goodLabel.toLowerCase()} · {formatCount(bad)}{" "}
            {badLabel.toLowerCase()}. Each cell approximates 1% of
            conversations.
          </p>
        </>
      ) : (
        <DonutChart
          data={data}
          label={title}
          totalLabel="Graded answers"
          size={180}
          formatValue={formatCount}
          legendAction="select"
        />
      )}
      {variant === "donut" && (
        <p className="mt-2 text-sm text-muted-foreground">
          {total ? ((good / total) * 100).toFixed(1) : "0"}%{" "}
          {goodLabel.toLowerCase()}
        </p>
      )}
    </ArcFrame>
  );
}
