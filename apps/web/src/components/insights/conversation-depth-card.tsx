"use client";

import { EmptyState } from "@/components/ui/empty-state";
import { ArcFrame } from "@/components/charts/arc/arc-frame";
import { LineChart } from "@/components/charts/arc/line-chart/line-chart";
import { AnalyticsCard } from "./analytics-card";
import { formatStat } from "@/lib/format";
import { formatDuration } from "@/lib/insights/dashboard-view";

interface Series {
  key: string;
  values: number[];
}

/**
 * How long a conversation lasts and how many questions it asks, per period.
 * Two panels rather than one chart: seconds and a count per conversation have
 * nothing in common but the x-axis, and sharing a y-axis would invent a
 * relationship between them.
 */
export function ConversationDepthCard({
  labels,
  series,
  avgConversationSeconds,
  questionsPerConversation,
}: {
  labels: string[];
  series: Series[];
  avgConversationSeconds: number | null;
  questionsPerConversation: number | null;
}) {
  const time = series.find((s) => s.key === "Avg. conversation time")?.values;
  const questions = series.find((s) => s.key === "Questions / Conversation")?.values;
  return (
    <AnalyticsCard title="Conversation depth"
      description="How long conversations last and how many questions Visitors ask in each, by the day the conversation started"
      contentClassName="grid gap-6 @3xl:grid-cols-2">
        <Panel
          title="Average conversation time"
          headline={formatDuration(avgConversationSeconds === null ? null : avgConversationSeconds * 1000)}
          caption="From the conversation's start to its last message"
          labels={labels}
          values={time}
          format={(seconds) => formatDuration(seconds * 1000)}
        />
        <Panel
          title="Questions per conversation"
          headline={questionsPerConversation === null ? "—" : formatStat(questionsPerConversation)}
          caption="Messages the Visitor sent"
          labels={labels}
          values={questions}
          format={(value) => formatStat(value)}
        />
    </AnalyticsCard>
  );
}


function Panel({
  title,
  headline,
  caption,
  labels,
  values,
  format,
}: {
  title: string;
  headline: string;
  caption: string;
  labels: string[];
  values: number[] | undefined;
  format: (value: number) => string;
}) {
  const data = labels.map((label, i) => ({ key: label, label, axisLabel: label, values: { value: values?.[i] ?? 0 } }));
  const empty = !values || values.every((v) => v === 0);
  return (
    <div className="min-w-0">
      <p className="text-muted-foreground text-sm">{title}</p>
      <p className="text-3xl font-semibold tracking-tight tabular-nums">{headline}</p>
      <p className="text-muted-foreground mb-3 text-xs">{caption}</p>
      {empty ? (
        <EmptyState size="sm" className="min-h-44" title="No conversations in this range" description="Choose a wider date range or wait for new conversations." />
      ) : (
        <ArcFrame><LineChart data={data} series={[{ key: "value", label: title, area: true }]}
          label={title} height={160} legend={false} formatValue={format} formatTick={format} /></ArcFrame>
      )}
    </div>
  );
}
