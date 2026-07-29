import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import type {
  ConversationMetadata,
  InsightsFilter,
  InsightsOverview,
} from "@agent-hub/core";
import { colorizeOverview } from "@agent-hub/core";

/**
 * Seeded-Postgres harness for the Insights read model (PRD #270, slice #271).
 *
 * Runs the REAL `get_insights_overview` SQL function — read verbatim from its
 * migration — inside an in-process PGlite instance, so the shipping analytics
 * path is exercised by a test with no Docker and no live database. The pure TS
 * `computeInsightsOverview` is the oracle; the parity tests diff the two over
 * identical seeded rows.
 *
 * The schema below is a deliberate SUBSET: only the columns of the five tables
 * (`assistants`, `knowledge_collections`, `conversations`, `messages`,
 * `sources`) that `get_insights_overview` actually reads. It is harness-owned
 * test infra — the function definition itself is the production artifact and is
 * never copied here.
 */

/**
 * Every migration that shapes the function, in apply order. A later one replaces
 * the function wholesale, so the list must stay complete: leave one out and the
 * harness silently tests an older read model than production ships.
 */
const MIGRATION_URLS = [
  "../../../../supabase/migrations/20260709205905_insights_sql_reporting.sql",
  "../../../../supabase/migrations/20260729110000_insights_proactive_notifications.sql",
].map((path) => new URL(path, import.meta.url));

// Minimal schema: the columns get_insights_overview touches, nothing else.
const SCHEMA_SQL = `
create schema if not exists public;
create table public.assistants (
  id text primary key,
  organization_id uuid not null,
  title text not null default ''
);
create table public.knowledge_collections (
  id text primary key,
  assistant_id text not null
);
create table public.conversations (
  id text primary key,
  assistant_id text not null,
  subject_id text,
  created_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb
);
create table public.messages (
  id bigserial primary key,
  conversation_id text not null,
  role text not null,
  feedback int not null default 0,
  created_at timestamptz not null,
  -- The reply parts; the proactive flag is a generated column the migration adds.
  content jsonb not null default '[]'::jsonb
);
create table public.sources (
  id text primary key,
  collection_id text not null,
  kind text not null,
  name text not null default '',
  config jsonb not null default '{}'::jsonb
);
`;

/** The migrations' DDL in order, minus the trailing GRANT/REVOKE (they need
 *  roles PGlite lacks). */
function functionDdl(): string {
  return MIGRATION_URLS.map((url) => {
    const sql = readFileSync(fileURLToPath(url), "utf8");
    const cut = sql.search(/^\s*revoke\s+execute/im);
    return cut === -1 ? sql : sql.slice(0, cut);
  }).join("\n");
}

export interface SeedAssistant {
  id: string;
  title: string;
}
export interface SeedConversation {
  id: string;
  assistantId: string;
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
export interface SeedCollection {
  id: string;
  assistantId: string;
}
export interface SeedWebsiteSource {
  id: string;
  collectionId: string;
  name: string;
  url: string;
}

export interface InsightsSeed {
  organizationId: string;
  assistants: SeedAssistant[];
  conversations: SeedConversation[];
  messages: SeedMessage[];
  collections?: SeedCollection[];
  sources?: SeedWebsiteSource[];
}

export interface InsightsHarness {
  /** Seed the given rows (replacing any prior seed) and run the real SQL
   *  function for `organizationId`; returns the colorized Overview. */
  run(seed: InsightsSeed, filter: InsightsFilter): Promise<InsightsOverview>;
  close(): Promise<void>;
}

/** Boots PGlite once, loads the schema + real function, pins UTC. Reuse the
 *  returned harness across many cases; `run` truncates between seeds. */
export async function createInsightsHarness(): Promise<InsightsHarness> {
  const db = new PGlite();
  await db.exec("set timezone = 'UTC';");
  await db.exec(SCHEMA_SQL);
  await db.exec(functionDdl());

  async function run(
    seed: InsightsSeed,
    filter: InsightsFilter
  ): Promise<InsightsOverview> {
    await db.exec(
      "truncate public.messages, public.conversations, public.sources, public.knowledge_collections, public.assistants;"
    );
    for (const a of seed.assistants) {
      await db.query(
        "insert into public.assistants (id, organization_id, title) values ($1, $2, $3)",
        [a.id, seed.organizationId, a.title]
      );
    }
    for (const kc of seed.collections ?? []) {
      await db.query(
        "insert into public.knowledge_collections (id, assistant_id) values ($1, $2)",
        [kc.id, kc.assistantId]
      );
    }
    for (const s of seed.sources ?? []) {
      await db.query(
        "insert into public.sources (id, collection_id, kind, name, config) values ($1, $2, 'website', $3, $4)",
        [s.id, s.collectionId, s.name, JSON.stringify({ url: s.url })]
      );
    }
    for (const c of seed.conversations) {
      await db.query(
        "insert into public.conversations (id, assistant_id, subject_id, created_at, metadata) values ($1, $2, $3, $4, $5)",
        [c.id, c.assistantId, c.subjectId, c.createdAt, JSON.stringify(c.metadata)]
      );
    }
    for (const m of seed.messages) {
      await db.query(
        "insert into public.messages (conversation_id, role, feedback, created_at, content) values ($1, $2, $3, $4, $5)",
        [
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
