"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Table2 } from "lucide-react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Button } from "@agent-hub/ui";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@agent-hub/ui";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export interface ChartSeries {
  key: string;
  color: string;
  /** One value per bucket, aligned with `labels`. */
  values: number[];
}

interface Row {
  key: string;
  label: string;
  color: string;
  values: number[];
  /** Legend total + share of the whole range — omitted for the Metrics tab,
   * where series aren't a partition of a single total. */
  total?: number;
  percent?: number;
}

type Tab = "metrics" | "assistants" | "channels";

const TABS: Array<{ id: Tab; label: string }> = [
  { label: "Metrics", id: "metrics" },
  { label: "Assistants", id: "assistants" },
  { label: "Channels", id: "channels" },
];

function formatValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function elapsedLabel(since: number, nowMs: number): string {
  const minutes = Math.floor((nowMs - since) / 60_000);
  if (minutes < 1) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes}m ago`;
  return `Updated ${Math.floor(minutes / 60)}h ago`;
}

/** Series keys are display strings ("Answers / Conversation") — map each to a
 * CSS-variable-safe dataKey for Recharts + the chart config. */
function slugifyKeys(rows: Row[]): Map<string, string> {
  const slugs = new Map<string, string>();
  const used = new Set<string>(["date"]);
  for (const row of rows) {
    let slug = row.key.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "series";
    while (used.has(slug)) slug = `${slug}-x`;
    used.add(slug);
    slugs.set(row.key, slug);
  }
  return slugs;
}

/**
 * "Usage" card: a tab strip (Metrics / Assistants / Channels) switches the
 * chart between a toggleable multi-line view of the KPI series and stacked
 * bar breakdowns by assistant or channel — the latter's legend rows carry a
 * total + share of the range.
 */
export function UsageCard({
  labels,
  metrics,
  assistants,
  channels,
  defaultVisibleMetrics,
}: {
  labels: string[];
  metrics: ChartSeries[];
  assistants: Row[];
  channels: Row[];
  defaultVisibleMetrics: string[];
}) {
  // Metrics starts with only the default series visible; breakdown tabs
  // start fully visible (every group contributes to the 100% split).
  const initialHiddenMetrics = useMemo(
    () => new Set(metrics.map((s) => s.key).filter((k) => !defaultVisibleMetrics.includes(k))),
    [metrics, defaultVisibleMetrics]
  );

  const [tab, setTab] = useState<Tab>("metrics");
  const [hidden, setHidden] = useState<Set<string>>(initialHiddenMetrics);
  const [showTable, setShowTable] = useState(false);
  const [mountedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  function selectTab(next: Tab) {
    setTab(next);
    setHidden(next === "metrics" ? initialHiddenMetrics : new Set());
  }

  const rows: Row[] = useMemo(() => {
    if (tab === "metrics") {
      return metrics.map((s) => ({ key: s.key, label: s.key, color: s.color, values: s.values }));
    }
    return tab === "assistants" ? assistants : channels;
  }, [tab, metrics, assistants, channels]);

  const visible = rows.filter((r) => !hidden.has(r.key));

  function toggle(key: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Breakdown tabs partition a single total → stack the areas; the Metrics tab
  // holds independent KPI series → overlap them with translucent fills.
  const stacked = tab !== "metrics";

  const slugs = useMemo(() => slugifyKeys(rows), [rows]);

  const chartConfig = useMemo(() => {
    const config: ChartConfig = {};
    for (const row of rows) {
      config[slugs.get(row.key)!] = { label: row.label, color: row.color };
    }
    return config;
  }, [rows, slugs]);

  const chartData = useMemo(
    () =>
      labels.map((label, i) => ({
        date: label,
        ...Object.fromEntries(rows.map((r) => [slugs.get(r.key)!, r.values[i]])),
      })),
    [labels, rows, slugs]
  );

  const xAxisProps = {
    dataKey: "date",
    tickLine: false,
    axisLine: false,
    tickMargin: 10,
    angle: -45,
    textAnchor: "end",
    height: 70,
    minTickGap: 12,
    tick: { fontSize: 11 },
  } as const;

  const yAxisProps = {
    tickLine: false,
    axisLine: false,
    width: 40,
    domain: [0, "auto"],
    tickFormatter: (v: number) => formatValue(v),
    tick: { fontSize: 12 },
  } as const;

  return (
    <Card>
      <CardHeader className="border-b [.border-b]:pb-4">
        <CardTitle className="text-lg font-semibold">Usage</CardTitle>
        <CardDescription>
          {tab === "metrics"
            ? "Conversation activity over time — click a metric to toggle it."
            : `Conversations split by ${tab === "assistants" ? "assistant" : "channel"}.`}
        </CardDescription>
      </CardHeader>

      <CardContent>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs value={tab} onValueChange={(value) => selectTab(value as Tab)}>
            <TabsList className="h-10 rounded-lg border bg-muted/50 p-1">
              {TABS.map((t) => (
                <TabsTrigger key={t.id} value={t.id} className="rounded-md px-3 py-1.5">
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <span className="text-muted-foreground text-sm">{elapsedLabel(mountedAt, now)}</span>
        </div>

        <ChartContainer config={chartConfig} className="mt-4 aspect-auto h-80 w-full">
          <AreaChart accessibilityLayer data={chartData} margin={{ left: 0, right: 12 }}>
            <defs>
              {visible.map((r) => {
                const slug = slugs.get(r.key)!;
                return (
                  <linearGradient key={slug} id={`fill-${slug}`} x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="5%"
                      stopColor={`var(--color-${slug})`}
                      stopOpacity={stacked ? 0.8 : 0.4}
                    />
                    <stop
                      offset="95%"
                      stopColor={`var(--color-${slug})`}
                      stopOpacity={stacked ? 0.1 : 0.05}
                    />
                  </linearGradient>
                );
              })}
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis {...xAxisProps} />
            <YAxis {...yAxisProps} />
            <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dot" />} />
            {visible.map((r) => {
              const slug = slugs.get(r.key)!;
              return (
                <Area
                  key={r.key}
                  dataKey={slug}
                  type="natural"
                  fill={`url(#fill-${slug})`}
                  stroke={`var(--color-${slug})`}
                  strokeWidth={2}
                  stackId={stacked ? "total" : undefined}
                  isAnimationActive={false}
                />
              );
            })}
          </AreaChart>
        </ChartContainer>

        {/* Legend — click to toggle a series/group; breakdown tabs show
            total + share of the range. */}
        <div className="mt-2">
          {rows.map((r) => {
            const on = !hidden.has(r.key);
            return (
              <button
                key={r.key}
                type="button"
                onClick={() => toggle(r.key)}
                aria-pressed={on}
                className={`flex w-full items-center gap-2.5 border-t py-3 text-left transition-opacity first:border-t-0 ${
                  on ? "" : "opacity-40"
                }`}
              >
                <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: r.color }} />
                <span className="truncate text-sm font-medium">{r.label}</span>
                {r.total !== undefined && (
                  <span className="text-muted-foreground ml-auto flex shrink-0 items-center gap-6 text-sm">
                    <span className="tabular-nums">{r.total.toLocaleString()}</span>
                    <span className="w-12 text-right tabular-nums">{r.percent}%</span>
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <Button
          type="button"
          variant="ghost"
          onClick={() => setShowTable((v) => !v)}
          className="text-foreground/80 mt-3 h-auto rounded-lg px-3 py-2 text-sm font-medium"
        >
          <Table2 className="size-4" />
          View data as table
          <ChevronDown className={`size-4 transition-transform ${showTable ? "rotate-180" : ""}`} />
        </Button>

        {showTable && (
          <div className="mt-2 overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead>Date</TableHead>
                  {visible.map((r) => (
                    <TableHead key={r.key} className="whitespace-nowrap">
                      {r.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {labels.map((label, i) => (
                  <TableRow key={label}>
                    <TableCell className="whitespace-nowrap">{label}</TableCell>
                    {visible.map((r) => (
                      <TableCell key={r.key}>{formatValue(r.values[i])}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
