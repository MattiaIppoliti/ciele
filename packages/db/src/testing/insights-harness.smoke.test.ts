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
  // 13 original metrics + Notifications (#546).
  expect(overview.chart.series).toHaveLength(14);
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

it("keeps org-wide facet options on the indexed read model", async () => {
  const definition = await harness.insightsFunctionDefinition();
  const roleOptions = definition.match(
    /role_options as\s*\(([\s\S]*?)\),\s*window_conversations as/i
  )?.[1];
  const plan = await harness.explainFacetLookup(ORG, "insights_role");

  expect(roleOptions).toContain("public.admin_read_facets");
  expect(roleOptions).not.toContain("public.conversations");
  expect(roleOptions).not.toContain("public.messages");
  expect(plan).toContain("admin_read_facets_pkey");
  expect(plan).not.toContain('"Node Type":"Seq Scan"');
  expect(plan).not.toContain('"Relation Name":"conversations"');
  expect(plan).not.toContain('"Relation Name":"messages"');
}, 30000);

it("does not hide valid facet values beyond the former 200-option cap", async () => {
  const overview = await harness.run(
    {
      organizationId: ORG,
      assistants: [{ id: "a1", title: "Assistant One" }],
      conversations: Array.from({ length: 205 }, (_, index) => ({
        id: `facet-${index}`,
        assistantId: "a1",
        subjectId: `visitor-${index}`,
        createdAt: "2025-01-01T00:00:00.000Z",
        metadata: { userRole: `role-${String(index).padStart(3, "0")}` },
      })),
      messages: [],
    },
    FILTER
  );

  expect(overview.options.roles).toHaveLength(205);
  expect(overview.options.roles).toContain("role-204");
  expect((await harness.readInboxFacets(ORG)).roles).toHaveLength(200);
}, 30000);

it("moves workflow facets when a Conversation changes tenant", async () => {
  const destinationOrg = "00000000-0000-0000-0000-000000000002";
  await harness.run(
    {
      organizationId: ORG,
      assistants: [{ id: "a1", title: "Assistant One" }],
      conversations: [
        {
          id: "c1",
          assistantId: "a1",
          subjectId: "visitor-1",
          createdAt: "2026-06-15T12:00:00.000Z",
          metadata: { userRole: "student" },
        },
      ],
      messages: [
        {
          conversationId: "c1",
          role: "user",
          feedback: 0,
          flowName: "Enrollment",
          createdAt: "2026-06-15T12:00:00.000Z",
        },
      ],
    },
    FILTER,
  );

  await harness.moveConversationToNewOrganization(
    "c1",
    destinationOrg,
    "a-destination",
  );

  expect((await harness.readInboxFacets(ORG)).workflows).toEqual([]);
  expect((await harness.readInboxFacets(destinationOrg)).workflows).toEqual([
    "Enrollment",
  ]);
}, 30000);

it("removes Conversation and Assistant facet memberships before cascades", async () => {
  await harness.run(
    {
      organizationId: ORG,
      assistants: [
        { id: "a1", title: "Assistant One" },
        { id: "a2", title: "Assistant Two" },
      ],
      conversations: [
        {
          id: "c1",
          assistantId: "a1",
          subjectId: "visitor-1",
          createdAt: "2026-06-15T12:00:00.000Z",
          metadata: {
            location: "Italy",
            city: "Rome",
            userRole: "student",
            language: "it",
          },
        },
        {
          id: "c2",
          assistantId: "a2",
          subjectId: "visitor-2",
          createdAt: "2026-06-15T12:00:00.000Z",
          metadata: {
            location: "France",
            city: "Paris",
            userRole: "staff",
            language: "fr",
          },
        },
      ],
      messages: [
        {
          conversationId: "c1",
          role: "user",
          feedback: 0,
          flowName: "Enrollment",
          createdAt: "2026-06-15T12:00:00.000Z",
        },
      ],
    },
    FILTER
  );

  await harness.deleteConversation("c1");
  expect(await harness.readInboxFacets(ORG)).toEqual({
    locations: ["France"],
    cities: ["Paris"],
    roles: ["staff"],
    languages: ["fr"],
    workflows: [],
  });

  await harness.deleteAssistant("a2");
  expect(await harness.readInboxFacets(ORG)).toEqual({
    locations: [],
    cities: [],
    roles: [],
    languages: [],
    workflows: [],
  });
}, 30000);

it("truncates between runs (empty seed → zeroed stats)", async () => {
  const overview = await harness.run(
    { organizationId: ORG, assistants: [], conversations: [], messages: [] },
    FILTER
  );
  expect(overview.stats.total).toBe(0);
  expect(overview.stats.resolutionRate).toBeNull();
}, 30000);
