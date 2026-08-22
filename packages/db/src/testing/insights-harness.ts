import type { PGlite } from "@electric-sql/pglite";
import type {
  ConversationMetadata,
  InsightsFilter,
  InsightsOverview,
} from "@agent-hub/core";
import { colorizeOverview } from "@agent-hub/core";

import { createSchemaLoadedPglite } from "./supabase-contract-harness";

/**
 * Seeded-Postgres harness for the Insights read model (PRD #270, slice #271).
 *
 * Runs the REAL `get_insights_overview` inside an in-process PGlite instance,
 * so the shipping analytics path is exercised by a test with no Docker and no
 * live database. The pure TS `computeInsightsOverview` is the oracle; the
 * parity tests diff the two over identical seeded rows.
 *
 * The schema is the REAL migration chain, applied by the contract harness.
 * It used to be a hand-written subset of "the columns the function reads",
 * which is how the function outlived one of them: #733 dropped
 * `knowledge_collections.assistant_id`, the subset kept it, every test stayed
 * green, and /insights 500'd in production on every request until
 * 20260821120000 fixed it. A `language sql` function is parsed on first call,
 * so nothing but calling it against the real schema can catch that class of
 * break, and that is now exactly what this harness does.
 */

export interface SeedAssistant {
  id: string;
  title: string;
}
export interface SeedConversation {
  id: string;
  assistantId: string;
  /** Defaults to "visitor"; "member" rows must be excluded (#668). */
  subjectType?: string;
  subjectId: string;
  createdAt: string;
  metadata: ConversationMetadata;
}
export interface SeedMessage {
  conversationId: string;
  role: "user" | "assistant";
  feedback: -1 | 0 | 1;
  createdAt: string;
  /** True to seed it as a proactive Notification's reply parts (#546). */
  proactive?: boolean;
}
/**
 * A crawled website, the unit behind the "Channels" filter. It lands as a
 * `website` Source in the org's Collection plus a link row to `assistantId`,
 * the shape the knowledge hub writes since Collections stopped belonging to an
 * Assistant (#733).
 */
export interface SeedWebsiteSource {
  id: string;
  name: string;
  url: string;
  assistantId: string;
}

export interface InsightsSeed {
  organizationId: string;
  assistants: SeedAssistant[];
  conversations: SeedConversation[];
  messages: SeedMessage[];
  sources?: SeedWebsiteSource[];
}

export interface InsightsHarness {
  /** Seed the given rows (replacing any prior seed) and run the real SQL
   *  function for `organizationId`; returns the colorized Overview. */
  run(seed: InsightsSeed, filter: InsightsFilter): Promise<InsightsOverview>;
  close(): Promise<void>;
}

/** One org-owned Collection holds every seeded website Source: which
 *  Collection a Source sits in stopped carrying reporting meaning. */
const COLLECTION_ID = "kc-insights-harness";

/** Boots PGlite once, applies the real schema, pins UTC. Reuse the returned
 *  harness across many cases; `run` truncates between seeds. */
export async function createInsightsHarness(): Promise<InsightsHarness> {
  const db: PGlite = await createSchemaLoadedPglite();

  async function run(
    seed: InsightsSeed,
    filter: InsightsFilter
  ): Promise<InsightsOverview> {
    // Demo rows the chain itself seeds go too, so a case only ever sees what
    // it asked for.
    await db.exec(
      `truncate table
         public.messages,
         public.conversations,
         public.assistant_sources,
         public.sources,
         public.knowledge_collections,
         public.assistants,
         public.organizations
       cascade;`
    );
    await db.query(
      "insert into public.organizations (id, name) values ($1, 'Insights Harness')",
      [seed.organizationId]
    );
    for (const a of seed.assistants) {
      await db.query(
        "insert into public.assistants (id, organization_id, title) values ($1, $2, $3)",
        [a.id, seed.organizationId, a.title]
      );
    }
    if (seed.sources?.length) {
      await db.query(
        `insert into public.knowledge_collections (id, name, description, organization_id)
         values ($1, 'Insights Harness', '', $2)`,
        [COLLECTION_ID, seed.organizationId]
      );
      for (const s of seed.sources) {
        await db.query(
          `insert into public.sources (id, collection_id, name, kind, status, config)
           values ($1, $2, $3, 'website', 'ready', $4)`,
          [s.id, COLLECTION_ID, s.name, JSON.stringify({ url: s.url })]
        );
        await db.query(
          "insert into public.assistant_sources (assistant_id, source_id) values ($1, $2)",
          [s.assistantId, s.id]
        );
      }
    }
    for (const c of seed.conversations) {
      await db.query(
        "insert into public.conversations (id, assistant_id, subject_type, subject_id, created_at, metadata) values ($1, $2, $3, $4, $5, $6)",
        [
          c.id,
          c.assistantId,
          c.subjectType ?? "visitor",
          c.subjectId,
          c.createdAt,
          JSON.stringify(c.metadata),
        ]
      );
    }
    let messageIndex = 0;
    for (const m of seed.messages) {
      // `id` is a caller-supplied shortId in production and `seq` is an
      // identity column, so the harness supplies the former and never the
      // latter.
      await db.query(
        "insert into public.messages (id, conversation_id, role, feedback, created_at, content) values ($1, $2, $3, $4, $5, $6)",
        [
          `m-${++messageIndex}`,
          m.conversationId,
          m.role,
          m.feedback,
          m.createdAt,
          JSON.stringify(
            m.proactive
              ? [{ type: "notification", action: "notification", content: "Nudge" }]
              : [{ type: "text", action: "custom_message", text: "Body" }]
          ),
        ]
      );
    }

    const result = await db.query<{ overview: InsightsOverview }>(
      "select public.get_insights_overview($1, $2, $3, $4, $5, $6, $7, $8, $9) as overview",
      [
        seed.organizationId,
        filter.from,
        filter.to,
        filter.aggregate,
        filter.assistantId || null,
        filter.channel || null,
        filter.role || null,
        filter.feedback || null,
        filter.escalation || null,
      ]
    );
    const overview = result.rows[0]?.overview;
    if (!overview || !overview.stats || !overview.chart || !overview.options) {
      throw new Error("Harness: get_insights_overview returned an invalid shape");
    }
    return colorizeOverview(overview);
  }

  return { run, close: () => db.close() };
}

/** Convenience: boot, run one case, tear down. Prefer the reusable harness for
 *  many cases. */
export async function runSqlInsightsOverview(
  seed: InsightsSeed,
  filter: InsightsFilter
): Promise<InsightsOverview> {
  const harness = await createInsightsHarness();
  try {
    return await harness.run(seed, filter);
  } finally {
    await harness.close();
  }
}
