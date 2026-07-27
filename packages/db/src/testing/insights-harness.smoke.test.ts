import { afterAll, beforeAll, expect, it } from "vitest";
import { createInsightsHarness, type InsightsHarness } from "./insights-harness";
import type { InsightsFilter } from "@agent-hub/core";

/**
 * Smoke test for the PGlite Insights harness (PRD #270, slice #271): proves the
 * in-process Postgres boots, loads the real `get_insights_overview`, and
 * returns a well-formed Overview for a trivial seed. Parity vs the TS oracle is
 * slice #273/#274; here we only assert the harness runs and the shape is intact.
 */

const ORG = "00000000-0000-0000-0000-000000000001";

const FILTER: InsightsFilter = {
  from: "2026-06-01",
  to: "2026-06-30",
  aggregate: "daily",
  assistantId: "",
  channel: "",
  role: "",
  feedback: "",
  escalation: "",
};

let harness: InsightsHarness;
// Generous timeout like db-contract.suite.ts: the harness boots PGlite and
// applies every migration, and parallel suites' boots contend for I/O.
beforeAll(async () => {
  harness = await createInsightsHarness();
}, 120_000);
afterAll(async () => {
  await harness?.close();
});

it("boots PGlite, runs the real SQL function, returns a well-formed Overview", async () => {
  const overview = await harness.run(
    {
      organizationId: ORG,
      assistants: [{ id: "a1", title: "Assistant One" }],
      conversations: [
        {
          id: "c1",
          assistantId: "a1",
          subjectId: "visitor-1",
          createdAt: "2026-06-15T12:00:00.000Z",
          metadata: { userRole: "student", language: "en" },
        },
      ],
      messages: [
        { conversationId: "c1", role: "user", feedback: 0, createdAt: "2026-06-15T12:00:00.000Z" },
        { conversationId: "c1", role: "assistant", feedback: 1, createdAt: "2026-06-15T12:00:01.000Z" },
      ],
    },
    FILTER
  );

  // Shape intact: every InsightsOverview branch present.
  expect(overview.stats).toBeTruthy();
  expect(overview.chart.series).toHaveLength(13);
  expect(overview.assistantBreakdown.series.length).toBeGreaterThan(0);
  expect(Array.isArray(overview.channelBreakdown.series)).toBe(true);
  expect(overview.options.roles).toContain("student");

  // The real function actually aggregated the seed.
  expect(overview.stats.total).toBe(1);
  expect(overview.stats.aiAnswers).toBe(1);
  expect(overview.stats.userMessages).toBe(1);
  expect(overview.stats.positive).toBe(1);
  expect(overview.stats.answerRating).toBe(100);
}, 30000);

it("truncates between runs (empty seed → zeroed stats)", async () => {
  const overview = await harness.run(
    { organizationId: ORG, assistants: [], conversations: [], messages: [] },
    FILTER
  );
  expect(overview.stats.total).toBe(0);
  expect(overview.stats.resolutionRate).toBeNull();
}, 30000);
