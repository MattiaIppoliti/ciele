"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@agent-hub/ui";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
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
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-semibold tracking-tight">Conversation depth</CardTitle>
        <CardDescription>
          How long conversations last and how many questions Visitors ask in each, by the day the conversation started
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-2">
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
      </CardContent>
    </Card>
  );
}

const CONFIG = { value: { label: "Value", color: "#2a78d6" } } satisfies ChartConfig;

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
  const data = labels.map((label, i) => ({ label, value: values?.[i] ?? 0 }));
  const empty = !values || values.every((v) => v === 0);
  return (
    <div className="min-w-0">
      <p className="text-muted-foreground text-sm">{title}</p>
      <p className="text-3xl font-semibold tracking-tight tabular-nums">{headline}</p>
      <p className="text-muted-foreground mb-3 text-xs">{caption}</p>
      {empty ? (
        <p className="text-muted-foreground flex h-44 items-center justify-center rounded-lg border border-dashed text-sm">
          No conversations with messages in this range.
        </p>
      ) : (
        <ChartContainer config={CONFIG} className="h-44 w-full">
          <AreaChart data={data} margin={{ left: 4, right: 8, top: 8 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={28} fontSize={10} />
            <YAxis tickLine={false} axisLine={false} width={60} fontSize={10} tickFormatter={format} />
            <ChartTooltip
              content={<ChartTooltipContent hideIndicator formatter={(value) => `${title}: ${format(Number(value))}`} />}
            />
            <Area
              dataKey="value"
              type="monotone"
              stroke="var(--color-value)"
              fill="var(--color-value)"
              fillOpacity={0.12}
              strokeWidth={2}
            />
          </AreaChart>
        </ChartContainer>
      )}
    </div>
  );
}
