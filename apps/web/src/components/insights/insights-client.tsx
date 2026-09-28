"use client";

import dynamic from "next/dynamic";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Activity, Download, UserRound, X } from "lucide-react";
import { BellRing, Calendar as CalendarIcon, Info, ListFilter } from "lucide-react";
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
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@agent-hub/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FilterSelect } from "@/components/ui/filter-select";
import { AssistantFilterDropdown } from "@/components/insights/assistant-filter-dropdown";
import { DateRangeDropdown, formatRange } from "@/components/insights/date-range-dropdown";
import { DeferredUsageCard } from "@/components/insights/deferred-usage-card";
import { formatDuration } from "@/lib/insights/dashboard-view";
import type {
  InsightsFilter,
  InsightsOverview,
} from "@/lib/insights/report";
import { RollInText } from "@/components/motion/roll-in-text";
import { downloadRows } from "@/lib/download";
import { formatCount, formatPercent, formatStat } from "@/lib/format";
import { DEFAULT_RANGE_DAYS, lastDaysRange } from "@/lib/insights/range";
import { toast } from "@/lib/toast";
import { replaceFilterParams } from "@/lib/url-state";

// Recharts stays off the first load, as it does for the usage chart below.
const ConversationDepthCard = dynamic(
  () => import("@/components/insights/conversation-depth-card").then((m) => m.ConversationDepthCard),
  { ssr: false, loading: () => <div className="bg-muted/40 h-[22rem] animate-pulse rounded-xl border" /> }
);

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

/**
 * The server's default window (`defaultInsightsFilter`), derived from the same
 * UTC helper, so a fresh visit leaves the address bar clean. Only ever called
 * from an effect or a click, never during render.
 */
function defaultFilters(): Filters {
  return {
    ...lastDaysRange(DEFAULT_RANGE_DAYS),
    aggregate: "daily",
    helpDesk: "",
    feedback: "",
    escalation: "",
    assistantId: "",
    channel: "",
    role: "",
  };
}

const FIELD_CLASS =
  "h-10 w-full rounded-lg border bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring/50 md:text-sm";

const SERIES_COLORS: Record<string, string> = {
  Conversations: "#2563eb",
  Escalation: "#059669",
  "AI answers": "#ea580c",
  "User messages": "#a855f7",
  "Unique users": "#0891b2",
  "Conversations / User": "#e11d48",
  "Answers / Conversation": "#4d7c0f",
  "Messages / Conversation": "#b45309",
  "Questions / Conversation": "#0f766e",
  "Avg. conversation time": "#7c3aed",
  "Resolution rate": "#a21caf",
  "Shortcut click": "#0d9488",
  "Answer rating": "#3b82f6",
  "Positive vote": "#22c55e",
  "Negative vote": "#f97316",
};

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
        <CardTitle className="text-lg font-semibold tracking-tight">
          <h2 className="flex items-center gap-3">
            {Icon && (
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border">
                <Icon className="size-4" aria-hidden />
              </span>
            )}
            {title}
          </h2>
        </CardTitle>
        {subtitle && <CardDescription>{subtitle}</CardDescription>}
      </CardHeader>
      <CardContent className="mt-auto flex items-end justify-between gap-3">
        {/* Every KPI rolls to its new value when a filter changes; the
            value is already formatted, so "N/A" and "—" roll as text. */}
        <p
          className={`min-w-0 text-3xl font-semibold tracking-tight tabular-nums sm:text-4xl ${valueClass ?? ""}`}
        >
          <RollInText text={value} />
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
  const filtersTitleId = useId();
  const dateCaptionId = useId();
  const dateValueId = useId();
  const [filters, setFilters] = useState<Filters>({ ...initialFilters, helpDesk: "" });
  // A reload or a copied link opens on the same range and filters. helpDesk
  // filters nothing server-side yet, so it is left out of the address bar.
  useEffect(() => {
    replaceFilterParams({ ...filters, helpDesk: "" }, defaultFilters());
  }, [filters]);
  const [overview, setOverview] = useState(initial);
  const [fetchedAt, setFetchedAt] = useState(() => Date.now());
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  // Bumped by Retry: the same filters, asked again.
  const [attempt, setAttempt] = useState(0);
  const firstRequest = useRef(true);

  useEffect(() => {
    if (firstRequest.current) {
      firstRequest.current = false;
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setRefreshing(true);
      setFailed(false);
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
        setFetchedAt(Date.now());
      } catch (error) {
        if ((error as DOMException).name === "AbortError") return;
        console.error(error);
        // The numbers on screen now describe the previous filters: say so
        // beside them instead of leaving them looking current.
        setFailed(true);
      } finally {
        if (!controller.signal.aborted) setRefreshing(false);
      }
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [filters, attempt]);

  const status = refreshing ? "Updating…" : failed ? "Couldn't update." : "";

  const stats = overview.stats;
  // Both arrive with the SQL function the same deploy ships. For the minutes
  // the app can run ahead of its migration they are absent: the questions
  // fall back to the same ratio from counts the old function already has,
  // the time to "no data".
  const avgConversationSeconds = stats.avgConversationSeconds ?? null;
  const questionsPerConversation =
    stats.questionsPerConversation ?? (stats.total > 0 ? Math.round((stats.userMessages / stats.total) * 10) / 10 : 0);
  const options = overview.options;
  const chart = useMemo(
    () => ({ ...overview.chart, series: overview.chart.series.map((series) => ({ ...series, color: SERIES_COLORS[series.key] })) }),
    [overview.chart]
  );

  function exportRows(format: "csv" | "json") {
    try {
      const rows = chart.labels.map((date, i) => ({
        date,
        ...Object.fromEntries(chart.series.map((s) => [s.key, s.values[i]])),
      }));
      downloadRows(rows, format, `insights-${filters.from}-to-${filters.to}.${format}`, ["date"]);
    } catch (error) {
      console.error(error);
      toast.error(`Couldn't export ${format.toUpperCase()}. Try again, or use Exports for a server-built file.`);
    }
  }

  return (
    <div className="flex min-h-full flex-col">
      {/* Header */}
      <header className="relative flex shrink-0 flex-wrap items-center gap-3 px-4 pt-5 pb-3 sm:px-6">
        <h1
          className="text-2xl font-bold tracking-tight"
          data-testid="insights-heading"
        >
          <RollInText text="Insights" />
        </h1>
        {/* Always mounted, so the live region exists before it has anything
            to say; a fixed width from sm up keeps its text from moving the
            controls as it rolls between states. */}
        <div className="flex min-w-0 flex-1 items-center gap-2 text-sm sm:w-52 sm:flex-none">
          <span role="status" aria-live="polite" className="text-muted-foreground whitespace-nowrap">
            <span aria-hidden>
              <RollInText text={status} />
            </span>
            <span className="sr-only">{status}</span>
          </span>
          {failed && !refreshing && (
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              className="press-text text-primary focus-visible:outline-ring rounded-sm font-semibold underline-offset-4 hover:underline focus-visible:outline-2"
            >
              Retry
            </button>
          )}
        </div>
        {/* Four controls, two of them wide date/assistant pickers: they wrap
            onto their own rows on a phone rather than clipping off-screen. */}
        <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto sm:flex-nowrap">
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
          <Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
            {/* The Popover owns Escape, outside click, aria-expanded and
                focus: into the panel on open, back to this button on close. */}
            <PopoverTrigger
              render={
                <Button
                  variant="outline"
                  aria-label="Filters"
                  className="h-10 shrink-0 rounded-lg px-3 sm:px-4"
                />
              }
            >
              <ListFilter className="size-4" aria-hidden />{" "}
              <span className="hidden sm:inline">Filters</span>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              aria-labelledby={filtersTitleId}
              className="max-h-[min(70vh,var(--available-height))] w-[calc(100vw-2rem)] overscroll-contain p-5 sm:w-96"
            >
              <div className="mb-4 flex items-center justify-between">
                <h2 id={filtersTitleId} className="text-lg font-semibold">
                  Filters
                </h2>
                <PopoverClose
                  render={
                    <button
                      type="button"
                      className="press-text text-primary focus-visible:outline-ring flex items-center gap-1 rounded-sm text-sm font-semibold hover:underline focus-visible:outline-2"
                    />
                  }
                >
                  <X className="size-4" aria-hidden /> Close
                </PopoverClose>
              </div>

              <div className="space-y-4">
                <div>
                  <span id={dateCaptionId} className="mb-1.5 block text-sm font-medium">
                    Date Range
                  </span>
                  <Popover open={dateRangeOpen} onOpenChange={setDateRangeOpen}>
                    <PopoverTrigger
                      render={
                        <button
                          type="button"
                          aria-labelledby={`${dateCaptionId} ${dateValueId}`}
                          className={FIELD_CLASS}
                        />
                      }
                    >
                      <span className="flex items-center gap-2">
                        <CalendarIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
                        <span id={dateValueId} className="whitespace-nowrap">
                          {formatRange(filters.from, filters.to)}
                        </span>
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
                        {(value: string) => AGGREGATE_LABELS[value as Aggregate]}
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
                    { value: "up", label: "Positive 🥰" },
                    { value: "down", label: "Negative 🤬" },
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
            </PopoverContent>
          </Popover>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="outline"
                  aria-label="Export"
                  className="h-10 shrink-0 rounded-lg px-3 sm:px-4"
                />
              }
            >
              <Download className="size-4" />{" "}
              <span className="hidden sm:inline">Export</span>
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

      </header>

      {/* Date range chip */}
      <div className="shrink-0 px-4 pb-4 sm:px-6">
        <span className="text-primary inline-flex items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/5 dark:border-primary/40 dark:bg-primary/15 px-3 py-1.5 text-sm font-medium">
          Date Range:{" "}
          <RollInText text={formatRange(filters.from, filters.to)} className="whitespace-nowrap" />
          <Hint label="Metrics cover conversations started in this range.">
            <button
              type="button"
              aria-label="About this range"
              className="focus-visible:outline-ring inline-flex rounded-sm hover:opacity-70 focus-visible:outline-2"
            >
              <Info className="size-3.5" aria-hidden />
            </button>
          </Hint>
        </span>
      </div>

      {/* Metric cards */}
      {/* After a failed refresh the numbers are the previous filters': dim
          them until a retry or the next change replaces them. */}
      <div
        aria-busy={refreshing}
        className={`grid grid-cols-12 gap-3 border-t px-4 pt-5 pb-6 transition-opacity sm:gap-4 sm:px-6 ${
          failed ? "opacity-60" : ""
        }`}
      >
        <StatCard
          title="AI Resolution Rate"
          value={stats.resolutionRate === null ? "N/A" : formatPercent(stats.resolutionRate)}
          valueClass="text-green-600"
          className="col-span-6 xl:col-span-3"
        />
        <StatCard
          title="Answer Rating"
          subtitle={`${formatStat(stats.positive)} positive and ${formatStat(stats.negative)} negative`}
          value={formatPercent(stats.answerRating)}
          valueClass="text-green-600"
          className="col-span-6 xl:col-span-3"
        />
        <StatCard
          icon={Activity}
          title="Number of Conversations"
          value={formatStat(stats.total)}
          className="col-span-6 xl:col-span-3"
        />
        <StatCard
          title="Escalated to Human"
          value={formatStat(stats.escalated)}
          className="col-span-6 xl:col-span-3"
        />
        {/* The two cards the pre-flight makes possible (#956). Both render a
            dash rather than 0% when nothing in the window carried the signal:
            a card reading 0% on a week the shadow did not run would be read as
            a terrible week rather than as no data. */}
        <StatCard
          title="Escalation Intent"
          value={
            stats.escalationIntentRate === null
              ? "—"
              : formatPercent(stats.escalationIntentRate)
          }
          subtitle="Asked for a person at least once"
          className="col-span-6 xl:col-span-3"
        />
        <StatCard
          title="Implicit Satisfaction"
          value={
            stats.implicitSatisfaction === null
              ? "—"
              : formatPercent(stats.implicitSatisfaction)
          }
          subtitle="Ended calm, among those nobody rated"
          className="col-span-6 xl:col-span-3"
        />

        <StatCard
          title="Languages Spoken"
          value={formatStat(stats.languages.length)}
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
                        <span className="text-muted-foreground tabular-nums">
                          {formatCount(count)} conversation{count === 1 ? "" : "s"}
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
          subtitle={`AI sent ${formatStat(stats.aiAnswers)} answers to ${formatStat(stats.userMessages)} user messages`}
          value={formatStat(stats.aiAnswers)}
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
              : `${formatCount(stats.notifications)} proactive message${stats.notifications === 1 ? "" : "s"} nobody had to ask for`
          }
          value={formatStat(stats.notifications)}
          className="col-span-12 sm:col-span-6 xl:col-span-4"
        />
        <StatCard
          icon={UserRound}
          title="Unique Users"
          subtitle={`${formatStat(stats.uniqueUsers)} user${stats.uniqueUsers === 1 ? "" : "s"} engaged with assistant`}
          value={formatStat(stats.uniqueUsers)}
          className="col-span-12 sm:col-span-6 xl:col-span-4"
        />

        <StatCard
          icon={Activity}
          title="Conversations / User"
          subtitle={`On average, each user started ${formatStat(stats.conversationsPerUser)} conversation${stats.conversationsPerUser === 1 ? "" : "s"}`}
          value={formatStat(stats.conversationsPerUser)}
          className="col-span-12 sm:col-span-6 xl:col-span-3"
        />
        <StatCard
          title="Answers / Conversation"
          value={formatStat(stats.answersPerConversation)}
          className="col-span-12 sm:col-span-6 xl:col-span-3"
        />
        <StatCard
          title="Questions / Conversation"
          subtitle="Messages the Visitor sent in each conversation"
          value={formatStat(questionsPerConversation)}
          className="col-span-12 sm:col-span-6 xl:col-span-3"
        />
        <StatCard
          title="Avg. Conversation Time"
          subtitle="From the start to the last message"
          value={formatDuration(avgConversationSeconds === null ? null : avgConversationSeconds * 1000)}
          className="col-span-12 sm:col-span-6 xl:col-span-3"
        />

        <div className="col-span-12">
          <ConversationDepthCard
            labels={chart.labels}
            series={chart.series}
            avgConversationSeconds={avgConversationSeconds}
            questionsPerConversation={questionsPerConversation}
          />
        </div>

        {/* Usage, Metrics / Assistants / Channels breakdown */}
        <div className="col-span-12">
          <DeferredUsageCard
            labels={chart.labels}
            metrics={chart.series}
            assistants={overview.assistantBreakdown.series}
            channels={overview.channelBreakdown.series}
            defaultVisibleMetrics={["Conversations", "Escalation"]}
            fetchedAt={fetchedAt}
          />
        </div>
      </div>
    </div>
  );
}
