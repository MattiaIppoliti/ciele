"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { ChevronDown, Table2 } from "lucide-react";
import { ArcFrame } from "@/components/charts/arc/arc-frame";
import { LineChart } from "@/components/charts/arc/line-chart/line-chart";
import { Streamgraph } from "@/components/charts/arc/streamgraph/streamgraph";
import { BrushChart } from "@/components/charts/arc/brush-chart/brush-chart";
import { Button } from "@agent-hub/ui";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@agent-hub/ui";
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
import { SlidingPanel, useSlidingDirection } from "@/components/motion/sliding-panel";
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

function metricUnit(key: string) {
  if (key === "Resolution rate" || key === "Answer rating") return "Percent";
  if (key === "Avg. conversation time") return "Seconds";
  return key.includes(" / ") ? "Per conversation / user" : "Counts";
}

/**
 * "Usage" card: a tab strip (Metrics / Assistants / Channels) switches the
 * chart between a toggleable multi-line view of the KPI series and stacked
 * area breakdowns by assistant or channel, the latter's legend rows carry a
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

  const [zoom, setZoom] = useState<{ signature: string; range: [number, number] } | null>(null);
  const signature = labels.join(",");
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

  const indices = labels.flatMap((label, index) => {
    const time = Date.parse(label.length === 7 ? `${label}-01T00:00:00Z` : `${label}T00:00:00Z`);
    return zoom?.signature === signature && (time < zoom.range[0] || time > zoom.range[1]) ? [] : [index];
  });
  const chartData = indices.map((index) => ({ key: labels[index]!, label: bucketLabel(labels[index]!, unit),
    axisLabel: tickLabel(labels[index]!, unit), values: Object.fromEntries(rows.map((row) => [row.key, row.values[index]])) }));
  const chartSeries = visible.map((row) => ({ key: row.key, label: row.label, color: row.color }));
  const metricGroups = ["Counts", "Percent", "Per conversation / user", "Seconds"].map((label) => ({
    label, series: chartSeries.filter((row) => metricUnit(row.key) === label),
  })).filter((group) => group.series.length > 0);
  const conversations = metrics.find((row) => row.key === "Conversations");
  const brushData = labels.map((label, index) => ({
    date: Date.parse(label.length === 7 ? `${label}-01T00:00:00Z` : `${label}T00:00:00Z`),
    value: conversations?.values[index] ?? 0,
  }));

  const slideDirection = useSlidingDirection(tab, TABS.map((tab) => tab.id));
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
          <Tabs value={tab} onValueChange={(value) => { if (value === "metrics" || value === "assistants" || value === "channels") selectTab(value); }}>
            {/* Library's pill rail: every section switcher in the console is
                the same control. */}
            <TabsList aria-label="Usage chart view">
              {TABS.map((t) => (
                <TabsTrigger key={t.id} value={t.id}>
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <span className="text-muted-foreground text-sm">{elapsedLabel(fetchedAt, now)}</span>
        </div>

        <SlidingPanel activeKey={tab} direction={slideDirection} sizing="flow">
          <ArcFrame className="mt-4 space-y-5">
            {tab === "metrics" ? metricGroups.map((group) => <div key={group.label}>
              <p className="mb-2 text-xs text-muted-foreground">{group.label}</p>
              <LineChart data={chartData} series={group.series} label={`Usage · ${group.label}`} height={240} legend={false}
                formatValue={(value) => group.label === "Percent" ? `${formatValue(value)}%` : formatValue(value)}
                formatTick={(value) => group.label === "Percent" ? `${COMPACT_FORMATTER.format(value)}%` : COMPACT_FORMATTER.format(value)} />
            </div>) : <Streamgraph data={chartData} series={chartSeries} label={`Conversations by ${tab}`}
              height={280} offset="zero" legend={false} directLabels={false} formatValue={formatValue} />}
            {tab === "metrics" && metricGroups.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">Select a metric below to show its trend.</p>}
            {conversations && brushData.length >= 2 && <div className="border-t pt-4">
              <p className="mb-2 text-sm font-medium">Explore conversations over time</p>
              <p className="mb-3 text-xs text-muted-foreground">Drag the window to zoom the charts above. Summary totals, the data table and exports cover the full selected range.</p>
              <BrushChart key={signature} data={brushData} bucket={unit} label="Conversations timeline" height={130} overviewHeight={40}
                minSpan={86_400_000} formatValue={formatValue} formatTick={(value) => COMPACT_FORMATTER.format(value)}
                formatDate={(date) => bucketLabel(date.toISOString().slice(0, unit === "month" ? 7 : 10), unit)}
                onRangeChange={(range) => setZoom({ signature, range })} />
            </div>}
          </ArcFrame>
        </SlidingPanel>
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
