import { afterAll, beforeAll, expect, it } from "vitest";
import { colorizeOverview, computeInsightsOverview } from "../insights";
import {
  ASSISTANTS,
  CHANNELS,
  FILTER_CASES,
  fixtureConversations,
  fixtureMessages,
} from "./insights-fixtures";
import {
  createInsightsHarness,
  type InsightsHarness,
  type InsightsSeed,
} from "./insights-harness";
import type { InboxConversation, InsightsMessage } from "../types";

/**
 * Insights TS↔SQL parity (PRD #270, slice #273): the first case that runs the
 * REAL `get_insights_overview` (via the PGlite harness) over the same fixtures
 * as the pure TS oracle and asserts they agree. Colors are normalized on both
 * sides (via colorizeOverview) so the diff is KPI content, not palette.
 *
 * Slice #273 covers the one daily / no-filter case (the tracer bullet). The
 * full matrix and any drift reconciliation are #274.
 */

const ORG = "00000000-0000-0000-0000-000000000001";

/** Map the shared TS fixtures onto the harness's DB-row seed. Each channel
 *  (OrgWebsiteSource) becomes a knowledge_collection + a website source. */
function seedFor(
  conversations: InboxConversation[],
  messages: InsightsMessage[]
): InsightsSeed {
  return {
    organizationId: ORG,
    assistants: ASSISTANTS.map((a) => ({ id: a.id, title: a.title })),
    collections: CHANNELS.map((ch) => ({ id: `kc-${ch.id}`, assistantId: ch.assistantId })),
    sources: CHANNELS.map((ch) => ({
      id: ch.id,
      collectionId: `kc-${ch.id}`,
      name: ch.name,
      url: ch.url,
    })),
    conversations: conversations.map((c) => ({
      id: c.id,
      assistantId: c.assistantId,
      subjectId: c.subjectId,
      createdAt: c.createdAt,
      metadata: c.metadata,
    })),
    messages: messages.map((m) => ({
      conversationId: m.conversationId,
      role: m.role,
      feedback: m.feedback,
      createdAt: m.createdAt,
    })),
  };
}

let harness: InsightsHarness;
const conversations = fixtureConversations();
const messages = fixtureMessages(conversations);

// Generous timeout like db-contract.suite.ts: the harness boots PGlite and
// applies every migration, and parallel suites' boots contend for I/O.
beforeAll(async () => {
  harness = await createInsightsHarness();
}, 120_000);
afterAll(async () => {
  await harness?.close();
});

it.each(FILTER_CASES.map((f, i) => [i, f] as const))(
  "case %i: real SQL matches the TS oracle (%o)",
  async (_i, filter) => {
    const expected = colorizeOverview(
      computeInsightsOverview(conversations, messages, ASSISTANTS, CHANNELS, filter)
    );
    const actual = await harness.run(seedFor(conversations, messages), filter);
    expect(actual).toEqual(expected);
  },
  30000
);
