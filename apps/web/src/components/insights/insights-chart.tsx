"use client";

import { useEffect, useId, useMemo, useState } from "react";
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
  TableCard,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TablePagination } from "@/components/ui/table-pagination";
import { Tabs, TabsList, TabsTrigger } from "@/components/motion/tabs";
import { RollingNumber } from "@/components/motion/rolling-number";
import { formatDay, formatShortDay, formatStat } from "@/lib/format";
import { DEFAULT_PAGE_SIZE, pageWindow } from "@/lib/pagination";

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
  /** Legend total + share of the whole range, omitted for the Metrics tab,
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

const formatValue = formatStat;

// "1.2K": a six-figure tick would otherwise overflow the axis gutter.
const COMPACT_FORMATTER = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const MONTH_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

type BucketUnit = "day" | "week" | "month";

/**
 * Labels are yyyy-mm-dd for a day or the Monday of a week, and yyyy-mm for a
 * month. Read the unit off the labels themselves rather than the filter, which
 * runs ahead of the data while a refresh is in flight.
 */
function bucketUnit(labels: string[]): BucketUnit {
  const [first, second] = labels;
  if (first && /^\d{4}-\d{2}$/.test(first)) return "month";
  if (first && second && Date.parse(second) - Date.parse(first) >= 7 * 86_400_000) return "week";
  return "day";
}

/** "3 Jul" on the axis, where the year goes without saying. */
function tickLabel(label: string, unit: BucketUnit): string {
  if (unit === "month") return MONTH_FORMATTER.format(new Date(`${label}-01`));
  return formatShortDay(label);
}

/** "03 Jul 2026", "Week of 29 Jun 2026" or "Jul 2026": a tooltip or table row. */
function bucketLabel(label: string, unit: BucketUnit): string {
  if (unit === "month") return MONTH_FORMATTER.format(new Date(`${label}-01`));
  return unit === "week" ? `Week of ${formatDay(label)}` : formatDay(label);
}

function elapsedLabel(since: number, nowMs: number): string {
  const minutes = Math.floor((nowMs - since) / 60_000);
  if (minutes < 1) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes}m ago`;
  return `Updated ${Math.floor(minutes / 60)}h ago`;
}

/** Series keys are display strings ("Answers / Conversation"), map each to a
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
 * bar breakdowns by assistant or channel, the latter's legend rows carry a
 * total + share of the range.
 */
export function UsageCard({
  labels,
  metrics,
  assistants,
  channels,
  defaultVisibleMetrics,
  fetchedAt,
}: {
  labels: string[];
  metrics: ChartSeries[];
  assistants: Row[];
  channels: Row[];
  defaultVisibleMetrics: string[];
  /** When this data was fetched, epoch ms: "Updated" counts from here. */
  fetchedAt: number;
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
  const dataTableId = useId();
  const summaryId = useId();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [now, setNow] = useState(() => Date.now());
  const unit = bucketUnit(labels);

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
  const tableWindow = pageWindow(page, pageSize, labels.length);
  const tableRows = labels
    .map((label, i) => ({ label, i }))
    .slice(Math.max(0, tableWindow.from - 1), tableWindow.to);
  const summary =
    labels.length === 0
      ? "Usage chart, no data in the selected range."
      : `Usage chart of ${
          visible.length ? visible.map((r) => r.label).join(", ") : "no series"
        } across ${labels.length} ${unit}${labels.length === 1 ? "" : "s"}, ${bucketLabel(
          labels[0]!,
          unit
        )} to ${bucketLabel(labels[labels.length - 1]!, unit)}. The data table below lists every value.`;

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
    tickFormatter: (label: string) => tickLabel(label, unit),
  } as const;

  const yAxisProps = {
    tickLine: false,
    axisLine: false,
    width: 44,
    domain: [0, "auto"],
    tickFormatter: (v: number) => COMPACT_FORMATTER.format(v),
    tick: { fontSize: 12 },
  } as const;

  return (
    <Card>
      <CardHeader className="border-b [.border-b]:pb-4">
        <CardTitle className="text-lg font-semibold">
          <h2>Usage</h2>
        </CardTitle>
        <CardDescription>
          {tab === "metrics"
            ? "Conversation activity over time, click a metric to toggle it."
            : `Conversations split by ${tab === "assistants" ? "assistant" : "channel"}.`}
        </CardDescription>
      </CardHeader>

      <CardContent>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs value={tab} onValueChange={(value) => selectTab(value as Tab)}>
            {/* Library's pill rail: every section switcher in the console is
                the same control. */}
            <TabsList aria-label="Usage chart view" className="bg-muted">
              {TABS.map((t) => (
                <TabsTrigger key={t.id} value={t.id}>
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <span className="text-muted-foreground text-sm">{elapsedLabel(fetchedAt, now)}</span>
        </div>

        {/* A figure, not an img: the accessibility layer keeps the chart
            keyboard-focusable, and an img's children are presentational. */}
        <ChartContainer
          config={chartConfig}
          role="figure"
          aria-label="Usage chart"
          aria-describedby={summaryId}
          className="mt-4 aspect-auto h-80 w-full"
        >
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
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  indicator="dot"
                  labelFormatter={(label) =>
                    typeof label === "string" ? bucketLabel(label, unit) : label
                  }
                />
              }
            />
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
        <p id={summaryId} className="sr-only">
          {summary}
        </p>

        {/* Legend, click to toggle a series/group; breakdown tabs show
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
                className={`press hover:bg-muted/50 focus-visible:outline-ring flex w-full items-center gap-2.5 border-t py-3 text-left first:border-t-0 focus-visible:outline-2 ${
                  on ? "" : "opacity-40"
                }`}
              >
                <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: r.color }} />
                <span className="truncate text-sm font-medium">{r.label}</span>
                {r.total !== undefined && (
                  <span className="text-muted-foreground ml-auto flex shrink-0 items-center gap-6 text-sm">
                    <RollingNumber value={r.total} />
                    <span className="w-12 text-right tabular-nums">
                      {r.percent === undefined ? "—" : <RollingNumber value={r.percent} format="percent" />}
                    </span>
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <Button
          type="button"
          variant="ghost"
          aria-expanded={showTable}
          aria-controls={dataTableId}
          onClick={() => setShowTable((v) => !v)}
          className="text-foreground/80 mt-3 h-auto rounded-lg px-3 py-2 text-sm font-medium"
        >
          <Table2 className="size-4" />
          {showTable ? "Hide data table" : "View data as table"}
          <ChevronDown className={`size-4 transition-transform ${showTable ? "rotate-180" : ""}`} />
        </Button>

        <div id={dataTableId} hidden={!showTable}>
          {showTable && (
          <TableCard
            className="mt-2"
            footer={
              <TablePagination
                page={page}
                pageSize={pageSize}
                total={labels.length}
                noun={unit}
                onPageChange={setPage}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setPage(1);
                }}
              />
            }
          >
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Date</TableHead>
                  {visible.map((r) => (
                    <TableHead key={r.key} className="text-right whitespace-nowrap">
                      {r.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {tableRows.map(({ label, i }) => (
                  <TableRow key={label}>
                    <TableCell className="whitespace-nowrap">{bucketLabel(label, unit)}</TableCell>
                    {visible.map((r) => (
                      <TableCell key={r.key} className="text-right tabular-nums">{formatValue(r.values[i])}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableCard>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
