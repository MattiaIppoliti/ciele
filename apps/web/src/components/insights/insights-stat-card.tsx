"use client";

import type { ComponentType, ReactNode } from "react";
import { AnalyticsCard } from "./analytics-card";
import { ArcFrame } from "@/components/charts/arc/arc-frame";
import { MetricCard } from "@/components/charts/arc/metric-card/metric-card";
import { RollInText } from "@/components/motion/roll-in-text";

export function InsightsStatCard({
  icon: Icon,
  title,
  subtitle,
  value,
  numericValue,
  suffix,
  decimals = 0,
  valueClass,
  action,
  className,
}: {
  icon?: ComponentType<{ className?: string }>;
  title: string;
  subtitle?: string;
  value: string;
  numericValue?: number;
  suffix?: string;
  decimals?: number;
  valueClass?: string;
  action?: ReactNode;
  className?: string;
}) {
  if (numericValue !== undefined) return <ArcFrame className={className}>
    <MetricCard label={title} value={numericValue} suffix={suffix} decimals={decimals} context={subtitle ?? "Selected range"} action={action} />
  </ArcFrame>;
  return (
    <AnalyticsCard title={<span className="flex items-center gap-2">{Icon && <Icon className="size-4 text-muted-foreground" aria-hidden />}{title}</span>} description={subtitle} className={className} action={action}>
      <p className={`min-w-0 text-3xl font-semibold tracking-tight tabular-nums ${valueClass ?? ""}`}>
        <RollInText text={value} />
      </p>
    </AnalyticsCard>
  );
}
