"use client";

import dynamic from "next/dynamic";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Activity, Download, UserRound, X } from "lucide-react";
import { BellRing, Calendar as CalendarIcon, ListFilter } from "lucide-react";
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
import { InsightsRangeChip } from "@/components/insights/insights-range-chip";
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
import { CHART_OUTCOMES, CHART_SERIES } from "@/components/charts/palette";
import { ArcFrame } from "@/components/charts/arc/arc-frame";
import { MetricCard } from "@/components/charts/arc/metric-card/metric-card";
import { DeferredUsageCard } from "@/components/insights/deferred-usage-card";
import { formatDuration } from "@/lib/insights/dashboard-view";
import type {
  InsightsFilter,
  InsightsOverview,
} from "@/lib/insights/report";
import { INSIGHTS_RANGE_SLOT, SlotPortal, TOP_BAR_SLOT } from "@/components/shell/slot-portal";
import { RollInText } from "@/components/motion/roll-in-text";
import { downloadRows } from "@/lib/download";
import { formatCount, formatPercent, formatStat } from "@/lib/format";
import { DEFAULT_RANGE_DAYS, lastDaysRange } from "@/lib/insights/range";
import { toast } from "@/lib/toast";
import { replaceFilterParams } from "@/lib/url-state";

// Chart code stays off the first load, as it does for the usage chart below.
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
  Conversations: CHART_SERIES[0],
  Escalation: CHART_SERIES[1],
  "AI answers": CHART_SERIES[2],
  "User messages": CHART_SERIES[3],
  "Unique users": CHART_SERIES[4],
  "Conversations / User": CHART_SERIES[0],
  "Answers / Conversation": CHART_SERIES[1],
  "Messages / Conversation": CHART_SERIES[2],
  "Questions / Conversation": CHART_SERIES[3],
  "Avg. conversation time": CHART_SERIES[4],
  "Resolution rate": CHART_SERIES[0],
  "Shortcut click": CHART_SERIES[1],
  "Answer rating": CHART_SERIES[2],
  "Positive vote": CHART_OUTCOMES.positive,
  "Negative vote": CHART_OUTCOMES.negative,
};

function StatCard({
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
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle?: string;
  value: string;
  numericValue?: number;
  suffix?: string;
  decimals?: number;
  valueClass?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  if (numericValue !== undefined) return <ArcFrame className={`arc-stat-card flex flex-col overflow-hidden rounded-xl border bg-card ${className ?? ""}`}>
    <MetricCard label={title} value={numericValue} suffix={suffix} decimals={decimals} context={subtitle ?? "Selected range"} />
    {action && <div className="mt-auto px-4 pb-4">{action}</div>}
  </ArcFrame>;
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
      <SlotPortal id={TOP_BAR_SLOT}>
        <div className="flex items-center gap-2">
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
                  className="h-8 shrink-0 rounded-lg px-2.5 lg:px-3"
                />
              }
            >
              <ListFilter className="size-4" aria-hidden />{" "}
              <span className="hidden lg:inline">Filters</span>
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
                    { value: "up", label: "Positive 🎉" },
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
                  className="h-8 shrink-0 rounded-lg px-2.5 lg:px-3"
                />
              }
            >
              <Download className="size-4" />{" "}
              <span className="hidden lg:inline">Export</span>
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
      </SlotPortal>

      {/* Date range chip */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 px-4 pt-3 pb-1 sm:px-6">
          <div className="order-last ml-auto flex min-w-0 items-center gap-2 text-sm">
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
      <SlotPortal id={INSIGHTS_RANGE_SLOT}>
        <InsightsRangeChip from={filters.from} to={filters.to} hint="Metrics cover conversations started in this range." />
      </SlotPortal>
      </div>

      {/* Metric cards */}
      {/* After a failed refresh the numbers are the previous filters': dim
          them until a retry or the next change replaces them. */}
      <div
        aria-busy={refreshing}
        className={`grid grid-cols-12 gap-3 px-4 pt-5 pb-6 transition-opacity sm:gap-4 sm:px-6 ${
          failed ? "opacity-60" : ""
        }`}
      >
        <StatCard
          title="AI Resolution Rate"
          value={stats.resolutionRate === null ? "N/A" : formatPercent(stats.resolutionRate)}
          numericValue={stats.resolutionRate ?? undefined}
          suffix="%"
          valueClass="text-green-600"
          className="col-span-6 @5xl:col-span-3"
        />
        <StatCard
          title="Answer Rating"
          subtitle={`${formatStat(stats.positive)} positive and ${formatStat(stats.negative)} negative`}
          value={stats.positive + stats.negative > 0 ? formatPercent(stats.answerRating) : "N/A"}
          numericValue={stats.positive + stats.negative > 0 ? stats.answerRating : undefined}
          suffix="%"
          valueClass="text-green-600"
          className="col-span-6 @5xl:col-span-3"
        />
        <StatCard
          icon={Activity}
          title="Number of Conversations"
          value={formatStat(stats.total)}
          numericValue={stats.total}
          className="col-span-6 @5xl:col-span-3"
        />
        <StatCard
          title="Escalated to Human"
          value={formatStat(stats.escalated)}
          numericValue={stats.escalated}
          className="col-span-6 @5xl:col-span-3"
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
          numericValue={stats.escalationIntentRate ?? undefined}
          suffix="%"
          subtitle="Asked for a person at least once"
          className="col-span-6 @5xl:col-span-3"
        />
        <StatCard
          title="Implicit Satisfaction"
          value={
            stats.implicitSatisfaction === null
              ? "—"
              : formatPercent(stats.implicitSatisfaction)
          }
          numericValue={stats.implicitSatisfaction ?? undefined}
          suffix="%"
          subtitle="Ended calm, among those nobody rated"
          className="col-span-6 @5xl:col-span-3"
        />

        <StatCard
          title="Languages Spoken"
          value={formatStat(stats.languages.length)}
          numericValue={stats.languages.length}
          className="col-span-12 @md:col-span-6 @5xl:col-span-4"
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
          numericValue={stats.aiAnswers}
          className="col-span-12 @md:col-span-6 @5xl:col-span-4"
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
          numericValue={stats.notifications}
          className="col-span-12 @md:col-span-6 @5xl:col-span-4"
        />
        <StatCard
          icon={UserRound}
          title="Unique Users"
          subtitle={`${formatStat(stats.uniqueUsers)} user${stats.uniqueUsers === 1 ? "" : "s"} engaged with assistant`}
          value={formatStat(stats.uniqueUsers)}
          numericValue={stats.uniqueUsers}
          className="col-span-12 @md:col-span-6 @5xl:col-span-4"
        />

        <StatCard
          icon={Activity}
          title="Conversations / User"
          subtitle={`On average, each user started ${formatStat(stats.conversationsPerUser)} conversation${stats.conversationsPerUser === 1 ? "" : "s"}`}
          value={formatStat(stats.conversationsPerUser)}
          numericValue={stats.conversationsPerUser}
          decimals={1}
          className="col-span-12 @md:col-span-6 @5xl:col-span-3"
        />
        <StatCard
          title="Answers / Conversation"
          value={formatStat(stats.answersPerConversation)}
          numericValue={stats.answersPerConversation}
          decimals={1}
          className="col-span-12 @md:col-span-6 @5xl:col-span-3"
        />
        <StatCard
          title="Questions / Conversation"
          subtitle="Messages the Visitor sent in each conversation"
          value={formatStat(questionsPerConversation)}
          numericValue={questionsPerConversation ?? undefined}
          decimals={1}
          className="col-span-12 @md:col-span-6 @5xl:col-span-3"
        />
        <StatCard
          title="Avg. Conversation Time"
          subtitle="From the start to the last message"
          value={formatDuration(avgConversationSeconds === null ? null : avgConversationSeconds * 1000)}
          className="col-span-12 @md:col-span-6 @5xl:col-span-3"
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
