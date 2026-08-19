import { describe, expect, it } from "vitest";
import { computeInsightsOverview, type InsightsFilter } from "@agent-hub/core";
import { DEMO_ORG, getMockDb } from "./index";

/**
 * The in-memory Db adapter agrees with the oracle.
 *
 * The oracle itself: `computeInsightsOverview` and the pure KPI functions it
 * composes, is tested in `@agent-hub/core` (`insights.test.ts`). This file
 * asserts only what an adapter can get wrong: that `Db.getInsightsOverview`
 * returns what the oracle computes over the same rows, and that it returns a
 * bounded payload rather than leaking raw conversation/message objects. The SQL
 * adapter's version of this is `testing/insights.parity.test.ts`.
 */

describe("Db.getInsightsOverview (mock adapter)", () => {
  const db = getMockDb();
  const filter: InsightsFilter = {
    from: "2020-01-01",
    to: "2030-01-01",
    aggregate: "monthly",
    assistantId: "",
    channel: "",
    role: "",
    feedback: "",
    escalation: "",
  };

  it("matches the oracle computed over the same org rows", async () => {
    const [conversations, messages, assistants, channels] = await Promise.all([
      db.listInboxConversations(DEMO_ORG.id),
      db.listInsightsMessages(DEMO_ORG.id),
      db.listAssistants(DEMO_ORG.id),
      db.listWebsiteSources(DEMO_ORG.id),
    ]);
    const expected = computeInsightsOverview(
      conversations,
      messages,
      assistants,
      channels,
      filter
    );
    const overview = await db.getInsightsOverview(DEMO_ORG.id, filter);
    expect(overview).toEqual(expected);
  });

  it("returns a bounded payload, metrics and series, never raw rows", async () => {
    const overview = await db.getInsightsOverview(DEMO_ORG.id, filter);
    expect(Object.keys(overview).sort()).toEqual([
      "assistantBreakdown",
      "channelBreakdown",
      "chart",
      "options",
      "stats",
    ]);
    // 14 named series: the 13 original metrics plus Notifications (#546).
    expect(overview.chart.series.length).toBe(overview.chart.labels.length > 0 ? 14 : 0);
    // No conversation/message object leaks into the payload.
    expect(JSON.stringify(overview)).not.toMatch(/"subjectId"|"metadata"|"conversationId"/);
  });

  it("returns sane zeros for an org with no conversations", async () => {
    const overview = await db.getInsightsOverview("00000000-0000-0000-0000-000000000000", filter);
    expect(overview.stats.total).toBe(0);
    expect(overview.stats.resolutionRate).toBeNull();
    expect(overview.assistantBreakdown.series).toEqual([]);
  });
});
