import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BarChart } from "./bar-chart/bar-chart";
import { SlopeChart } from "./slope-chart/slope-chart";
import { MetricCard } from "./metric-card/metric-card";
import { RateDonut } from "@/components/insights/dashboard/dashboard-donut";

function text(markup: string) {
  return markup.replace(/<[^>]+>/g, "");
}

describe("chart numeric and accessible output", () => {
  it("keeps a sub-cent daily average in visible copy and the accessible chart summary", () => {
    const markup = renderToStaticMarkup(
      createElement(BarChart, {
        label: "Daily spend",
        period: "Two days",
        data: [
          { key: "one", label: "First day", value: 0.0001 },
          { key: "two", label: "Second day", value: 0.0005 },
        ],
        formatValue: (value) => `€${value.toFixed(4)}`,
      }),
    );
    expect(markup).toContain("Daily average €0.0003");
    expect(text(markup)).toContain("€0.0003");
  });
  it("keeps fractional numeric cards readable independently of animated digits", () => {
    const markup = renderToStaticMarkup(
      createElement(MetricCard, {
        label: "Cost per turn",
        value: 0.0003,
        prefix: "€",
        decimals: 4,
        context: "Selected range",
      }),
    );
    expect(text(markup)).toContain("€0.0003");
    expect(markup).toContain('aria-hidden="true"');
  });
  it("keeps exact conversation counts when a waffle share rounds below one cell", () => {
    const markup = renderToStaticMarkup(
      createElement(RateDonut, {
        good: 997,
        bad: 3,
        goodLabel: "Resolved",
        badLabel: "Escalated",
        title: "Autonomy",
        variant: "waffle",
        loading: false,
      }),
    );
    expect(text(markup)).toContain("997 resolved · 3 escalated");
    expect(text(markup)).toContain("Each cell approximates 1%");
  });
  it("omits rate rankings when a slope compares independent percentage measures", () => {
    const markup = renderToStaticMarkup(
      createElement(SlopeChart, {
        label: "Rates",
        startLabel: "Prior",
        endLabel: "Current",
        ranks: false,
        data: [{ key: "success", label: "Reliability", start: 95, end: 97 }],
      }),
    );
    expect(markup).not.toContain('scope="col">Rank');
    expect(text(markup)).toContain("Reliability");
  });
  it("does not expose old measurements while a rate chart is loading", () => {
    const markup = renderToStaticMarkup(
      createElement(RateDonut, {
        good: 90,
        bad: 10,
        goodLabel: "Passed",
        badLabel: "Failed",
        title: "Accuracy",
        loading: true,
      }),
    );
    expect(markup).toContain("Loading chart");
    expect(markup).not.toContain("90");
  });
});
