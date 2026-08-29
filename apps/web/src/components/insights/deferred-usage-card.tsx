"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import type { ChartSeries } from "./insights-chart";

const UsageCard = dynamic(() =>
  import("./insights-chart").then((module) => module.UsageCard),
);

interface BreakdownSeries {
  key: string;
  label: string;
  color: string;
  values: number[];
  total?: number;
  percent?: number;
}

/** Keep Recharts out of the critical path until its card nears the viewport. */
export function DeferredUsageCard(props: {
  labels: string[];
  metrics: ChartSeries[];
  assistants: BreakdownSeries[];
  channels: BreakdownSeries[];
  defaultVisibleMetrics: string[];
}) {
  const root = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (visible || !root.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setVisible(true);
        observer.disconnect();
      },
      { rootMargin: "300px" },
    );
    observer.observe(root.current);
    return () => observer.disconnect();
  }, [visible]);

  return (
    <div ref={root} className="min-h-[28rem]">
      {visible ? (
        <UsageCard {...props} />
      ) : (
        <div
          aria-label="Loading usage chart"
          className="bg-muted/40 h-[28rem] animate-pulse rounded-xl border"
        />
      )}
    </div>
  );
}
