import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createSchemaLoadedPglite } from "./supabase-contract-harness";

/**
 * The expand-contract *migrate* step for org-owned knowledge (PRD #726,
 * ticket #728). Runs the REAL migration against seeded legacy rows: the
 * harness boots the full schema (the migration no-ops on an empty database),
 * the test then seeds pre-upgrade assistant-owned collections/sources/FAQ
 * concepts/chunks and re-runs the file — legitimate because the migration is
 * idempotent by design, and exactly what a self-hoster's upgrade does.
 */

const MIGRATION = fileURLToPath(
  new URL(
    "../../../../supabase/migrations/20260816110500_knowledge_backfill.sql",
    import.meta.url
  )
);

let pg: PGlite;
let orgId: string;
let emptyOrgId: string;

const runMigration = () => pg.exec(readFileSync(MIGRATION, "utf8"));

beforeAll(async () => {
  pg = await createSchemaLoadedPglite();
  orgId = randomUUID();
  emptyOrgId = randomUUID();
  await pg.query(`insert into public.organizations (id, name) values ($1, $2)`, [
    orgId,
    "Legacy Knowledge U",
  ]);
  await pg.query(`insert into public.organizations (id, name) values ($1, $2)`, [
    emptyOrgId,
    "Empty Org",
  ]);

  await pg.query(
    `insert into public.assistants (id, title, organization_id)
     values ('as-legacy', 'Legacy Assistant', $1)`,
    [orgId]
  );
  // A pre-expand collection: assistant-owned, no organization stamp.
  await pg.exec(`
    insert into public.knowledge_collections (id, assistant_id, name)
    values ('col-legacy', 'as-legacy', 'Legacy Collection');

    insert into public.sources (id, collection_id, name, kind, status)
    values ('src-site', 'col-legacy', 'Legacy Site', 'website', 'ready');

    insert into public.concepts (id, collection_id, source_id, path, frontmatter, body)
    values ('con-page', 'col-legacy', 'src-site', 'web/page.md',
            '{"type": "Web Page", "title": "Page"}', 'page body');

    insert into public.concepts (id, collection_id, source_id, path, frontmatter, body)
    values ('con-faq', 'col-legacy', null, 'faq/hours.md',
            '{"type": "FAQ", "title": "What are the opening hours?"}',
            'We are open 9 to 5.');

    insert into public.concepts (id, collection_id, source_id, path, frontmatter, body)
    values ('con-note', 'col-legacy', null, 'notes/authored.md',
            '{"type": "Note", "title": "Authored note"}', 'note body');

    insert into public.concept_chunks (id, concept_id, collection_id, assistant_id, content)
    values ('chk-page', 'con-page', 'col-legacy', 'as-legacy', 'page body chunk');

    insert into public.concept_chunks (id, concept_id, collection_id, assistant_id, content)
    values ('chk-faq', 'con-faq', 'col-legacy', 'as-legacy', 'faq answer chunk');

    insert into public.concept_chunks (id, concept_id, collection_id, assistant_id, content)
    values ('chk-note', 'con-note', 'col-legacy', 'as-legacy', 'note chunk');
  `);

  await runMigration();
}, 120_000);

afterAll(async () => {
  await pg?.close();
});

describe("knowledge backfill migration (#728)", () => {
  it("stamps every collection with its assistant's organization", async () => {
    const { rows } = await pg.query<{ n: number }>(
      `select count(*)::int as n from public.knowledge_collections
       where organization_id is null`
    );
    expect(rows[0].n).toBe(0);
    const { rows: legacy } = await pg.query<{ organization_id: string }>(
      `select organization_id from public.knowledge_collections
       where id = 'col-legacy'`
    );
    expect(legacy[0].organization_id).toBe(orgId);
  });

  it("links every pre-existing source to exactly its original assistant, direct access off", async () => {
    const { rows } = await pg.query<{
      assistant_id: string;
      source_id: string;
      direct_access: boolean;
    }>(`select assistant_id, source_id, direct_access
        from public.assistant_sources order by source_id`);
    // src-site plus the synthetic FAQ source — one link each, to as-legacy.
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.assistant_id === "as-legacy")).toBe(true);
    expect(rows.every((r) => r.direct_access === false)).toBe(true);
    expect(rows.map((r) => r.source_id).sort()).toEqual(
      ["faqsrc-con-faq", "src-site"].sort()
    );
  });

  it("gives every FAQ concept a synthetic faq source named by its question", async () => {
    const { rows } = await pg.query<{
      source_id: string;
      name: string;
      kind: string;
      status: string;
    }>(
      `select c.source_id, s.name, s.kind, s.status
       from public.concepts c join public.sources s on s.id = c.source_id
       where c.id = 'con-faq'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].source_id).toBe("faqsrc-con-faq");
    expect(rows[0].name).toBe("What are the opening hours?");
    expect(rows[0].kind).toBe("faq");
    expect(rows[0].status).toBe("ready");
    // Non-FAQ authored concepts are untouched: they stay source-less and
    // their chunks keep legacy assistant scoping.
    const { rows: note } = await pg.query<{ source_id: string | null }>(
      `select source_id from public.concepts where id = 'con-note'`
    );
    expect(note[0].source_id).toBeNull();
  });

  it("backfills chunk source ids consistently with their concepts", async () => {
    const { rows } = await pg.query<{ n: number }>(
      `select count(*)::int as n
       from public.concept_chunks cc
       join public.concepts c on c.id = cc.concept_id
       where coalesce(cc.source_id, '') is distinct from coalesce(c.source_id, '')`
    );
    expect(rows[0].n).toBe(0);
  });

  it("keeps retrieval reach unchanged: every source-aware chunk is linked to its original assistant", async () => {
    const { rows } = await pg.query<{ n: number }>(
      `select count(*)::int as n
       from public.concept_chunks cc
       where cc.source_id is not null
         and not exists (
           select 1 from public.assistant_sources l
           where l.source_id = cc.source_id
             and l.assistant_id = cc.assistant_id
         )`
    );
    expect(rows[0].n).toBe(0);
  });

  it("creates the per-org Knowledge Library default collection", async () => {
    const { rows } = await pg.query<{ id: string; assistant_id: string | null }>(
      `select id, assistant_id from public.knowledge_collections
       where organization_id = $1 and id like 'org-library-%'`,
      [emptyOrgId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].assistant_id).toBeNull();
  });

  it("re-running is a no-op: no duplicate links, sources, or collections", async () => {
    await runMigration();
    const { rows: links } = await pg.query<{ n: number }>(
      `select count(*)::int as n from public.assistant_sources`
    );
    expect(links[0].n).toBe(2);
    const { rows: faqSources } = await pg.query<{ n: number }>(
      `select count(*)::int as n from public.sources where kind = 'faq'`
    );
    expect(faqSources[0].n).toBe(1);
    // Exactly one library per organization (the harness seeds orgs of its
    // own, so assert shape, not an absolute count).
    const { rows: libraries } = await pg.query<{ n: number; d: number }>(
      `select count(*)::int as n, count(distinct organization_id)::int as d
       from public.knowledge_collections where id like 'org-library-%'`
    );
    expect(libraries[0].n).toBe(libraries[0].d);
    expect(libraries[0].n).toBeGreaterThanOrEqual(2);
  });
});
