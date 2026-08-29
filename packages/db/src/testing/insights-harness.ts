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
export interface SeedTeammate {
  id: string;
  name: string;
}
export interface SeedConversation {
  id: string;
  /** Null on a Teammate Conversation, which has no Assistant (#768). */
  assistantId: string | null;
  /** Set instead of `assistantId` for internal Teammate chat (#768). */
  teammateId?: string | null;
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
  flowName?: string;
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
  teammates?: SeedTeammate[];
  conversations: SeedConversation[];
  messages: SeedMessage[];
  sources?: SeedWebsiteSource[];
}

export interface InsightsHarness {
  /** Seed the given rows (replacing any prior seed) and run the real SQL
   *  function for `organizationId`; returns the colorized Overview. */
  run(seed: InsightsSeed, filter: InsightsFilter): Promise<InsightsOverview>;
  /** Query-plan guard for the org-wide facet lookup used by Insights/Inbox. */
  explainFacetLookup(organizationId: string, facet: string): Promise<string>;
  insightsFunctionDefinition(): Promise<string>;
  readInboxFacets(organizationId: string): Promise<{
    locations: string[];
    cities: string[];
    roles: string[];
    languages: string[];
    workflows: string[];
  }>;
  deleteConversation(conversationId: string): Promise<void>;
  deleteAssistant(assistantId: string): Promise<void>;
  moveConversationToNewOrganization(
    conversationId: string,
    organizationId: string,
    assistantId: string,
  ): Promise<void>;
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
         public.teammates,
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
    for (const t of seed.teammates ?? []) {
      // No owner: the harness seeds no auth.users rows, and ownership is not
      // an input to any Insights aggregate.
      await db.query(
        "insert into public.teammates (id, organization_id, name) values ($1, $2, $3)",
        [t.id, seed.organizationId, t.name]
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
        "insert into public.conversations (id, assistant_id, teammate_id, subject_type, subject_id, created_at, metadata) values ($1, $2, $3, $4, $5, $6, $7)",
        [
          c.id,
          c.assistantId,
          c.teammateId ?? null,
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
        "insert into public.messages (id, conversation_id, role, feedback, created_at, content, flow_name) values ($1, $2, $3, $4, $5, $6, $7)",
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
          m.flowName ?? null,
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

  async function explainFacetLookup(
    organizationId: string,
    facet: string
  ): Promise<string> {
    await db.exec("set enable_seqscan = off;");
    try {
      const result = await db.query(
        `explain (format json)
         select value
         from public.admin_read_facets
         where organization_id = $1 and facet = $2 and refs > 0
         order by value`,
        [organizationId, facet]
      );
      return JSON.stringify(result.rows);
    } finally {
      await db.exec("reset enable_seqscan;");
    }
  }

  async function insightsFunctionDefinition(): Promise<string> {
    const result = await db.query<{ definition: string }>(
      `select pg_get_functiondef(p.oid) as definition
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'get_insights_overview'`
    );
    return result.rows[0]?.definition ?? "";
  }

  async function readInboxFacets(organizationId: string) {
    const result = await db.query<{
      facets: {
        locations: string[];
        cities: string[];
        roles: string[];
        languages: string[];
        workflows: string[];
      };
    }>("select public.get_inbox_facets($1) as facets", [organizationId]);
    const facets = result.rows[0]?.facets;
    if (!facets) throw new Error("Harness: get_inbox_facets returned no row");
    return facets;
  }

  async function deleteConversation(conversationId: string): Promise<void> {
    await db.query("delete from public.conversations where id = $1", [
      conversationId,
    ]);
  }

  async function deleteAssistant(assistantId: string): Promise<void> {
    await db.query("delete from public.assistants where id = $1", [assistantId]);
  }

  async function moveConversationToNewOrganization(
    conversationId: string,
    organizationId: string,
    assistantId: string,
  ): Promise<void> {
    await db.query(
      "insert into public.organizations (id, name) values ($1, 'Facet Destination')",
      [organizationId],
    );
    await db.query(
      "insert into public.assistants (id, organization_id, title) values ($1, $2, 'Facet Destination')",
      [assistantId, organizationId],
    );
    await db.query(
      "update public.conversations set assistant_id = $1 where id = $2",
      [assistantId, conversationId],
    );
  }

  return {
    run,
    explainFacetLookup,
    insightsFunctionDefinition,
    readInboxFacets,
    deleteConversation,
    deleteAssistant,
    moveConversationToNewOrganization,
    close: () => db.close(),
  };
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
