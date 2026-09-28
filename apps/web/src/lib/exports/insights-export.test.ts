import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import type { InsightsOverview } from "@/lib/insights/report";
import { columnName, insightsExportTable, renderExportTable } from "./insights-export";

const OVERVIEW = {
  stats: {
    total: 12,
    escalated: 3,
    resolutionRate: null,
    positive: 4,
    negative: 1,
    answerRating: 80,
    aiAnswers: 20,
    notifications: 0,
    userMessages: 22,
    uniqueUsers: 9,
    conversationsPerUser: 1.3,
    answersPerConversation: 1.7,
    languages: [
      ["Italian", 7],
      ["English", 5],
    ],
    implicitSatisfaction: null,
    escalationIntentRate: 25,
    questionsPerConversation: 1.8,
    avgConversationSeconds: null,
  },
  chart: {
    labels: ["2026-09-01", "2026-09-02"],
    series: [{ key: "Conversations", values: [5, 7] }],
  },
  assistantBreakdown: { labels: [], series: [] },
  channelBreakdown: { labels: [], series: [] },
  options: { roles: [], channels: [] },
} as unknown as InsightsOverview;

describe("insightsExportTable", () => {
  it("lays the aggregated report out one row per bucket", () => {
    expect(insightsExportTable("insights_overview", OVERVIEW)).toEqual({
      headers: ["date", "Conversations"],
      rows: [
        ["2026-09-01", 5],
        ["2026-09-02", 7],
      ],
    });
  });

  it("leaves a rate the window cannot measure empty rather than zero", () => {
    const { rows } = insightsExportTable("insights_datapoints", OVERVIEW);
    expect(rows).toContainEqual(["AI resolution rate (%)", ""]);
    expect(rows).toContainEqual(["Escalation intent (%)", 25]);
    expect(rows).toContainEqual(["Languages spoken", 2]);
    expect(rows).toContainEqual(["Questions per conversation", 1.8]);
    expect(rows).toContainEqual(["Average conversation time (seconds)", ""]);
  });

  it("lists conversations per language", () => {
    expect(insightsExportTable("insights_languages", OVERVIEW).rows).toEqual([
      ["Italian", 7],
      ["English", 5],
    ]);
  });
});

describe("renderExportTable", () => {
  const table = { headers: ["language", "conversations"], rows: [["=cmd()", 7] as Array<string | number>] };

  it("neutralises a formula-looking cell in CSV", async () => {
    expect(await renderExportTable("csv", table, "x")).toBe("language,conversations\n'=cmd(),7");
  });

  it("writes JSON as one object per row", async () => {
    expect(JSON.parse((await renderExportTable("json", table, "x")) as string)).toEqual([
      { language: "=cmd()", conversations: 7 },
    ]);
  });

  it("writes a workbook whose sheet keeps numbers numeric and text inline", async () => {
    const body = await renderExportTable("xlsx", table, "Languages: 1/2");
    const zip = await JSZip.loadAsync(body as Uint8Array);
    const sheet = await zip.file("xl/worksheets/sheet1.xml")?.async("string");
    expect(sheet).toContain('<c r="B2"><v>7</v></c>');
    expect(sheet).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">=cmd()</t></is></c>');
    const workbook = await zip.file("xl/workbook.xml")?.async("string");
    expect(workbook).toContain('name="Languages  1 2"');
    expect(zip.file("[Content_Types].xml")).not.toBeNull();
  });

  it("names columns past Z the way a spreadsheet does", () => {
    expect([0, 25, 26, 51, 52].map(columnName)).toEqual(["A", "Z", "AA", "AZ", "BA"]);
  });
});
