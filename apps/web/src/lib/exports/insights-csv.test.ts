import { describe, expect, it } from "vitest";
import type { InsightsOverview } from "@/lib/insights/report";
import { insightsOverviewToCsv } from "./insights-csv";

function overview(partial: Partial<InsightsOverview["chart"]>): InsightsOverview {
  return {
    stats: {} as InsightsOverview["stats"],
    chart: {
      labels: partial.labels ?? [],
      series: partial.series ?? [],
    } as InsightsOverview["chart"],
    assistantBreakdown: { labels: [], series: [] } as InsightsOverview["assistantBreakdown"],
    channelBreakdown: { labels: [], series: [] } as InsightsOverview["channelBreakdown"],
    options: { roles: [], channels: [] },
  };
}

describe("insightsOverviewToCsv", () => {
  it("renders a date column plus one column per series, one row per bucket", () => {
    const csv = insightsOverviewToCsv(
      overview({
        labels: ["2026-07-01", "2026-07-02"],
        series: [
          { key: "Conversations", values: [3, 5] },
          { key: "AI answers", values: [2, 4] },
        ] as InsightsOverview["chart"]["series"],
      })
    );
    expect(csv.split("\n")).toEqual([
      '"date","Conversations","AI answers"',
      '"2026-07-01","3","2"',
      '"2026-07-02","5","4"',
    ]);
  });

  it("defaults a missing series value to 0 and escapes quotes", () => {
    const csv = insightsOverviewToCsv(
      overview({
        labels: ["2026-07-01"],
        series: [
          { key: 'Odd "key"', values: [] },
        ] as InsightsOverview["chart"]["series"],
      })
    );
    expect(csv.split("\n")).toEqual(['"date","Odd ""key"""', '"2026-07-01","0"']);
  });
});
