"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  BellRing,
  Calendar as CalendarIcon,
  Download,
  Info,
  ListFilter,
  UserRound,
  X,
} from "lucide-react";
import { Button } from "@agent-hub/ui";
import { CalendarRange } from "@/components/ui/calendar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@agent-hub/ui";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@agent-hub/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Hint } from "@agent-hub/ui";
import { Popover, PopoverContent, PopoverTrigger } from "@agent-hub/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AssistantFilterDropdown } from "@/components/insights/assistant-filter-dropdown";
import { DateRangeDropdown } from "@/components/insights/date-range-dropdown";
import { UsageCard } from "@/components/insights/insights-chart";
import type {
  InsightsFilter,
  InsightsOverview,
} from "@/lib/insights/report";

interface AssistantOption {
  id: string;
  title: string;
}

type Aggregate = "daily" | "weekly" | "monthly";

const AGGREGATE_LABELS: Record<Aggregate, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

interface Filters extends InsightsFilter {
  helpDesk: string;
}

function defaultFilters(): Filters {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  const isoDay = (date: Date) => {
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}`;
  };
  return {
    from: isoDay(from),
    to: isoDay(to),
    aggregate: "daily",
    helpDesk: "",
    feedback: "",
    escalation: "",
    assistantId: "",
    channel: "",
    role: "",
  };
}

function formatStat(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

const FIELD_CLASS =
  "h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/50";

const SERIES_COLORS: Record<string, string> = {
  Conversations: "#2563eb",
  Escalation: "#059669",
  "AI answers": "#ea580c",
  "User messages": "#a855f7",
  "Unique users": "#0891b2",
  "Conversations / User": "#e11d48",
  "Answers / Conversation": "#4d7c0f",
  "Messages / Conversation": "#b45309",
  "Resolution rate": "#a21caf",
  "Shortcut click": "#0d9488",
  "Answer rating": "#3b82f6",
  "Positive vote": "#22c55e",
  "Negative vote": "#f97316",
};

function FilterSelect({
  label,
  value,
  placeholder,
  options,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <Select value={value} onValueChange={(v) => onChange(v as string)}>
        <SelectTrigger>
          <SelectValue>
            {(v: string) => options.find((o) => o.value === v)?.label || placeholder}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">{placeholder}</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

function StatCard({
  icon: Icon,
  title,
  subtitle,
  value,
  valueClass,
  action,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle?: string;
  value: string;
  valueClass?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-3 text-lg font-semibold tracking-tight">
          {Icon && (
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border">
              <Icon className="size-4" />
            </span>
          )}
          {title}
        </CardTitle>
        {subtitle && <CardDescription>{subtitle}</CardDescription>}
      </CardHeader>
      <CardContent className="mt-auto flex items-end justify-between gap-3">
        <p
          className={`text-4xl font-semibold tracking-tight ${valueClass ?? ""}`}
        >
          {value}
        </p>
        {action}
      </CardContent>
    </Card>
  );
}

export function InsightsClient({
  initial,
  initialFilters,
  assistants,
}: {
  initial: InsightsOverview;
  initialFilters: InsightsFilter;
  assistants: AssistantOption[];
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [dateRangeOpen, setDateRangeOpen] = useState(false);
  const [filters, setFilters] = useState<Filters>({ ...initialFilters, helpDesk: "" });
  const [overview, setOverview] = useState(initial);
  const [refreshing, setRefreshing] = useState(false);
  const firstRequest = useRef(true);

  useEffect(() => {
    if (firstRequest.current) {
      firstRequest.current = false;
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setRefreshing(true);
      const params = new URLSearchParams({
        from: filters.from,
        to: filters.to,
        aggregate: filters.aggregate,
        assistantId: filters.assistantId,
        channel: filters.channel,
        role: filters.role,
        feedback: filters.feedback,
        escalation: filters.escalation,
      });
      try {
        const response = await fetch(`/api/insights?${params}`, { signal: controller.signal });
        if (!response.ok) throw new Error("Insights unavailable");
        setOverview((await response.json()) as InsightsOverview);
      } catch (error) {
        if ((error as DOMException).name !== "AbortError") console.error(error);
      } finally {
        if (!controller.signal.aborted) setRefreshing(false);
      }
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [filters]);

  const stats = overview.stats;
  const options = overview.options;
  const chart = useMemo(
    () => ({ ...overview.chart, series: overview.chart.series.map((series) => ({ ...series, color: SERIES_COLORS[series.key] })) }),
    [overview.chart]
  );

  function exportRows(format: "csv" | "json") {
    const rows = chart.labels.map((date, i) => ({
      date,
      ...Object.fromEntries(chart.series.map((s) => [s.key, s.values[i]])),
    }));
    let blob: Blob;
    if (format === "json") {
      blob = new Blob([JSON.stringify(rows, null, 2)], {
        type: "application/json",
      });
    } else {
      const headers = Object.keys(rows[0] ?? { date: "" });
      const escape = (v: unknown) => `"${String(v).replaceAll('"', '""')}"`;
      const csv = [
        headers.join(","),
        ...rows.map((r) =>
          headers.map((h) => escape(r[h as keyof typeof r])).join(",")
        ),
      ].join("\n");
      blob = new Blob([csv], { type: "text/csv" });
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `insights.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex min-h-full flex-col">
      {/* Header */}
      <header className="relative flex shrink-0 flex-wrap items-center gap-3 px-6 pt-5 pb-3">
        <h1 className="text-2xl font-bold tracking-tight">Insights</h1>
        {refreshing && <span className="text-muted-foreground text-sm">Updating…</span>}
        <div className="ml-auto flex items-center gap-2">
          <DateRangeDropdown
            from={filters.from}
            to={filters.to}
            onChange={(from, to) => setFilters({ ...filters, from, to })}
          />
          <AssistantFilterDropdown
            assistants={assistants}
            value={filters.assistantId}
            onChange={(assistantId) =>
              setFilters({ ...filters, assistantId, channel: "" })
            }
          />
          <Button
            variant="outline"
            className="h-10 rounded-lg px-4"
            onClick={() => setFiltersOpen((open) => !open)}
          >
            <ListFilter className="size-4" /> Filters
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="outline" className="h-10 rounded-lg px-4" />}
            >
              <Download className="size-4" /> Export
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => exportRows("csv")}>
                Export CSV
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportRows("json")}>
                Export JSON
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Filters panel */}
        {filtersOpen && (
          <div className="absolute top-full right-6 z-30 max-h-[70vh] w-96 overflow-y-auto rounded-xl border bg-popover p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Filters</h2>
              <button
                type="button"
                onClick={() => setFiltersOpen(false)}
                className="text-primary flex items-center gap-1 text-sm font-semibold"
              >
                <X className="size-4" /> Close
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <span className="mb-1.5 block text-sm font-medium">
                  Date Range
                </span>
                <Popover open={dateRangeOpen} onOpenChange={setDateRangeOpen}>
                  <PopoverTrigger
                    render={<button type="button" className={FIELD_CLASS} />}
                  >
                    <span className="flex items-center gap-2">
                      <CalendarIcon className="text-muted-foreground size-4 shrink-0" />
                      {filters.from || "…"} — {filters.to || "…"}
                    </span>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-3" align="start">
                    <CalendarRange
                      from={filters.from || null}
                      to={filters.to || null}
                      onSelect={(from, to, complete) => {
                        setFilters({ ...filters, from, to });
                        if (complete) setDateRangeOpen(false);
                      }}
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">
                  Aggregated
                </span>
                <Select
                  value={filters.aggregate}
                  onValueChange={(value) =>
                    setFilters({
                      ...filters,
                      aggregate: value as Aggregate,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue>
                      {(v: Aggregate) => AGGREGATE_LABELS[v]}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <FilterSelect
                label="Help Desks"
                value={filters.helpDesk}
                placeholder="All Help Desks"
                options={[]}
                onChange={(helpDesk) => setFilters({ ...filters, helpDesk })}
              />
              <FilterSelect
                label="Feedback"
                value={filters.feedback}
                placeholder="All Feedbacks"
                options={[
                  { value: "up", label: "Positive 👍" },
                  { value: "down", label: "Negative 👎" },
                ]}
                onChange={(feedback) =>
                  setFilters({
                    ...filters,
                    feedback: feedback as Filters["feedback"],
                  })
                }
              />
              <FilterSelect
                label="Escalation"
                value={filters.escalation}
                placeholder="All Escalations"
                options={[
                  { value: "escalated", label: "Escalated" },
                  { value: "not_escalated", label: "Not escalated" },
                ]}
                onChange={(escalation) =>
                  setFilters({
                    ...filters,
                    escalation: escalation as Filters["escalation"],
                  })
                }
              />
              <FilterSelect
                label="Channels"
                value={filters.channel}
                placeholder="All Channels"
                options={options.channels}
                onChange={(channel) => setFilters({ ...filters, channel })}
              />
              <FilterSelect
                label="Roles"
                value={filters.role}
                placeholder="All Roles"
                options={options.roles.map((v) => ({ value: v, label: v }))}
                onChange={(role) => setFilters({ ...filters, role })}
              />
              <div className="flex justify-end pt-1">
                <Button
                  variant="ghost"
                  onClick={() => setFilters(defaultFilters())}
                  className="text-sm"
                >
                  Reset filters
                </Button>
              </div>
            </div>
          </div>
        )}
      </header>

      {/* Date range chip */}
      <div className="shrink-0 px-6 pb-4">
        <span className="text-primary inline-flex items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/5 dark:border-primary/40 dark:bg-primary/15 px-3 py-1.5 text-sm font-medium">
          Date Range: {filters.from || "…"} — {filters.to || "…"}
          <Hint label="Metrics cover conversations started in this range.">
            <Info className="size-3.5" />
          </Hint>
        </span>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-12 gap-4 border-t px-6 pt-5 pb-6">
        <StatCard
          title="AI Resolution Rate"
          value={stats.resolutionRate === null ? "—" : `${stats.resolutionRate} %`}
          valueClass="text-green-600"
          className="col-span-12 sm:col-span-6 xl:col-span-3"
        />
        <StatCard
          title="Answer Rating"
          subtitle={`${stats.positive} positive and ${stats.negative} negative`}
          value={`${stats.answerRating} %`}
          valueClass="text-green-600"
          className="col-span-12 sm:col-span-6 xl:col-span-3"
        />
        <StatCard
          icon={Activity}
          title="Number of Conversations"
          value={String(stats.total)}
          className="col-span-12 sm:col-span-6 xl:col-span-3"
        />
        <StatCard
          title="Escalated to Human"
          value={String(stats.escalated)}
          className="col-span-12 sm:col-span-6 xl:col-span-3"
        />

        <StatCard
          title="Languages Spoken"
          value={String(stats.languages.length)}
          className="col-span-12 sm:col-span-6 xl:col-span-4"
          action={
            <Dialog>
              <DialogTrigger
                render={
                  <button
                    type="button"
                    className="text-sm font-semibold underline underline-offset-4 hover:opacity-70"
                  />
                }
              >
                View breakdown
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Languages Spoken</DialogTitle>
                </DialogHeader>
                {stats.languages.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    No language data in the selected range.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {stats.languages.map(([language, count]) => (
                      <li
                        key={language}
                        className="flex items-center justify-between text-sm"
                      >
                        <span className="font-medium">{language}</span>
                        <span className="text-muted-foreground">
                          {count} conversation{count === 1 ? "" : "s"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </DialogContent>
            </Dialog>
          }
        />
        <StatCard
          title="Number of AI Answers"
          subtitle={`AI sent ${stats.aiAnswers} answers to ${stats.userMessages} user messages`}
          value={String(stats.aiAnswers)}
          className="col-span-12 sm:col-span-6 xl:col-span-4"
        />
        {/* Proactive nudges are counted on their own, never as answers (#546):
            switching proactive flows on must not move the answer KPIs. */}
        <StatCard
          icon={BellRing}
          title="Notifications Sent"
          subtitle={
            stats.notifications === 0
              ? "No proactive notifications delivered"
              : `${stats.notifications} proactive message${stats.notifications === 1 ? "" : "s"} nobody had to ask for`
          }
          value={String(stats.notifications)}
          className="col-span-12 sm:col-span-6 xl:col-span-4"
        />
        <StatCard
          icon={UserRound}
          title="Unique Users"
          subtitle={`${stats.uniqueUsers} user${stats.uniqueUsers === 1 ? "" : "s"} engaged with assistant`}
          value={String(stats.uniqueUsers)}
          className="col-span-12 sm:col-span-6 xl:col-span-4"
        />

        <StatCard
          icon={Activity}
          title="Conversations / User"
          subtitle={`On average, each user started ${formatStat(stats.conversationsPerUser)} conversation${stats.conversationsPerUser === 1 ? "" : "s"}`}
          value={formatStat(stats.conversationsPerUser)}
          className="col-span-12 xl:col-span-6"
        />
        <StatCard
          title="Answers / Conversation"
          value={formatStat(stats.answersPerConversation)}
          className="col-span-12 xl:col-span-6"
        />

        {/* Usage — Metrics / Assistants / Channels breakdown */}
        <div className="col-span-12">
          <UsageCard
            labels={chart.labels}
            metrics={chart.series}
            assistants={overview.assistantBreakdown.series}
            channels={overview.channelBreakdown.series}
            defaultVisibleMetrics={["Conversations", "Escalation"]}
          />
        </div>
      </div>
    </div>
  );
}
