"use client";

import { useEffect, useState } from "react";
import type {
  AssistantAvailabilityFact,
  AssistantAvailabilityTarget,
  UsageDashboardFilter,
} from "@agent-hub/core";
import {
  assistantAvailabilityDays,
  currentAssistantAvailability,
} from "@agent-hub/core";
import { AnalyticsCard } from "@/components/insights/analytics-card";
import { StatusBars } from "@/components/block/status-bars";
import { lastDaysRange } from "@/lib/insights/range";

interface AvailabilityView {
  assistants: AssistantAvailabilityTarget[];
  facts: AssistantAvailabilityFact[];
}
export function AssistantAvailabilityCard({
  filter,
}: {
  filter: UsageDashboardFilter;
}) {
  const [result, setResult] = useState<{
    key: string;
    data: AvailabilityView;
  } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(
    null,
  );
  const [now, setNow] = useState(() => new Date());
  // Availability keeps a 90-day strip, ending at the dashboard’s selected end date.
  const { from, to } = lastDaysRange(90, new Date(`${filter.to}T12:00:00Z`));
  const key = `${from}:${to}`;
  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    const load = async () => {
      try {
        const response = await fetch(
          `/api/insights/availability?from=${from}&to=${to}`,
          { signal: controller.signal, cache: "no-store" },
        );
        if (!response.ok)
          throw new Error(
            response.status === 503
              ? "Availability monitoring is awaiting its database migration."
              : "Could not load availability checks.",
          );
        const data: AvailabilityView = await response.json();
        if (!disposed) {
          setResult({ key, data });
          setError(null);
          setNow(new Date());
        }
      } catch (e) {
        if (!disposed && !controller.signal.aborted)
          setError({
            key,
            message:
              e instanceof Error
                ? e.message
                : "Could not load availability checks.",
          });
      }
    };
    void load();
    const timer = setInterval(() => void load(), 60000);
    return () => {
      disposed = true;
      controller.abort();
      clearInterval(timer);
    };
  }, [from, to, key]);
  const data = result?.key === key ? result.data : null;
  const assistants =
    data?.assistants.filter(
      (a) => !filter.assistantId || filter.assistantId === a.id,
    ) ?? [];
  return (
    <AnalyticsCard
      title="Published Assistant availability"
      contentClassName="p-6"
    >
      <div className="space-y-8">
        {error?.key === key ? (
          <p role="status" className="text-sm text-muted-foreground">
            {error.message}
          </p>
        ) : !data ? (
          <StatusBars label="Published Assistants" days={[]} loading />
        ) : assistants.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No published Assistants in this selection.
          </p>
        ) : (
          assistants.map((a) => (
            <StatusBars
              key={a.id}
              label={a.title}
              days={assistantAvailabilityDays(
                a.id,
                data.facts,
                from,
                to,
              )}
              current={currentAssistantAvailability(a.id, data.facts, now)}
              maxDays={90}
            />
          ))
        )}
      </div>
    </AnalyticsCard>
  );
}
