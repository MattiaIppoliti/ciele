import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createSupabaseDb } from "../supabase";
import { createPgliteSupabaseClient } from "./postgrest-shim";
import { createSchemaLoadedPglite } from "./supabase-contract-harness";

let pg: PGlite;
let db: ReturnType<typeof createSupabaseDb>;
let client: ReturnType<typeof createPgliteSupabaseClient>;
let organizationId: string;
let foreignOrganizationId: string;
let assistantId: string;
const userId = randomUUID();
const RPC_SIGNATURE = "public.get_org_knowledge_source_page(uuid, text[], text, text, text, bigint, bigint)";

beforeAll(async () => {
  pg = await createSchemaLoadedPglite();
  await pg.query("insert into auth.users (id, email) values ($1, 'library@perf-test.edu')", [userId]);
  await pg.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  client = createPgliteSupabaseClient(pg, { id: userId, email: "library@perf-test.edu" });
  db = createSupabaseDb(client);
  organizationId = await db.createOrganization("Library performance");
  const assistant = await db.createAssistant(organizationId, { title: "Library owner" });
  assistantId = assistant.id;
  const collection = await db.createCollection(assistant.id, { name: "Shared library" });
  await pg.query(`
    insert into public.sources (id, collection_id, name, kind, status, created_at)
    select 'library-source-' || i, $1, 'Library source ' || i, 'file',
           case when i % 2 = 0 then 'ready' else 'processing' end,
           '2026-01-01'::timestamptz + i * interval '1 second'
    from generate_series(1, 60) i`, [collection.id]);
  const faq = await db.createSource({ collectionId: collection.id, name: "Literal 50%_\\ answer", kind: "faq" });
  await db.setSourceAssistantLinks(faq.id, [assistant.id]);
  await db.createConcept({
    collectionId: collection.id, sourceId: faq.id, path: "answer.md",
    frontmatter: { type: "FAQ", title: "Answer" }, body: "Visible answer ".repeat(40),
  });
  await pg.query(`
    insert into public.concepts (id, collection_id, source_id, path, body, generation_id, is_active)
    values ('staged-library-answer', $1, $2, 'staged.md', 'Do not display', $3, false)`,
  [collection.id, faq.id, randomUUID()]);

  foreignOrganizationId = randomUUID();
  await pg.query("insert into public.organizations (id, name) values ($1, 'Foreign library')", [foreignOrganizationId]);
  await pg.query("insert into public.knowledge_collections (id, organization_id, name) values ('foreign-library', $1, 'Private')", [foreignOrganizationId]);
  await pg.exec("insert into public.sources (id, collection_id, name, kind) values ('foreign-library-source', 'foreign-library', 'Foreign secret', 'file')");
  await pg.exec(`
    grant usage on schema public, private to authenticated;
    grant select on all tables in schema public to authenticated;
  `);
});

afterAll(async () => { await pg?.close(); });

describe("Knowledge Library bounded reads", () => {
  it("hydrates a page with one RPC, regardless of Source count, and keeps totals on empty pages", async () => {
    const rpc = vi.spyOn(client, "rpc");
    const from = vi.spyOn(client, "from");
    try {
      const page = await db.listOrgKnowledgeSources(organizationId, { kinds: ["file"], page: 2, pageSize: 25 });
      expect(page.items).toHaveLength(25);
      expect(page.total).toBe(60);
      expect(page.statusCounts).toEqual({ ready: 30, processing: 30, error: 0 });
      expect(page.items[0].id).toBe("library-source-35");
      expect(rpc).toHaveBeenCalledTimes(1);
      expect(from).not.toHaveBeenCalled();
      const counts = await db.listOrgKnowledgeSources(organizationId, { kinds: ["file"], pageSize: 0 });
      expect(counts).toEqual({ items: [], total: 60, statusCounts: page.statusCounts });
      const empty = await db.listOrgKnowledgeSources(organizationId, { kinds: ["file"], page: 9, pageSize: 25 });
      expect(empty).toEqual(counts);
    } finally { vi.restoreAllMocks(); }
  });

  it("preserves literal search, links and active-generation FAQ previews", async () => {
    const page = await db.listOrgKnowledgeSources(organizationId, {
      kinds: ["faq"], assistantId, query: "  50%_\\  ",
    });
    expect(page.total).toBe(1);
    expect(page.items[0].conceptCount).toBe(1);
    expect(page.items[0].answerPreview).toBe("Visible answer ".repeat(40).slice(0, 200));
    expect(page.items[0].linkedAssistants).toEqual([{ assistantId, assistantName: "Library owner", directAccess: false }]);
  });

  it("keeps adjacent pages disjoint when Sources share a creation timestamp", async () => {
    await pg.exec("begin; update public.sources set created_at = '2026-01-01' where id like 'library-source-%'");
    try {
      const first = await db.listOrgKnowledgeSources(organizationId, { kinds: ["file"], page: 1, pageSize: 25 });
      const second = await db.listOrgKnowledgeSources(organizationId, { kinds: ["file"], page: 2, pageSize: 25 });
      const expected = Array.from({ length: 60 }, (_, i) => `library-source-${i + 1}`).sort().reverse();
      expect([...first.items, ...second.items].map((item) => item.id)).toEqual(expected.slice(0, 50));
    } finally { await pg.exec("rollback"); }
  });

  it("reads bounded scope identities without requesting Concept or link tables", async () => {
    const from = vi.spyOn(client, "from");
    try {
      const options = await db.listOrgKnowledgeSourceOptions(organizationId, { kinds: ["file"], limit: 5 });
      expect(options.items).toHaveLength(5);
      expect(options.total).toBe(60);
      expect(Object.keys(options.items[0]).sort()).toEqual(["collectionId", "id", "kind", "name"]);
      expect(from.mock.calls).toEqual([["sources"]]);
    } finally { vi.restoreAllMocks(); }
  });

  it("enforces the authenticated Member's RLS for both projections and counts", async () => {
    await pg.exec("set role authenticated");
    try {
      expect((await db.listOrgKnowledgeSources(organizationId, { kinds: ["file"] })).total).toBe(60);
      expect(await db.listOrgKnowledgeSources(foreignOrganizationId, { kinds: ["file"] })).toEqual({
        items: [], total: 0, statusCounts: { ready: 0, processing: 0, error: 0 },
      });
      expect(await db.listOrgKnowledgeSourceOptions(foreignOrganizationId, { kinds: ["file"], limit: 5 })).toEqual({ items: [], total: 0 });
    } finally { await pg.exec("reset role"); }
  });

  it("falls back during deploy-before-migrate without masking authorization errors", async () => {
    await pg.exec(`alter function ${RPC_SIGNATURE} rename to hidden_knowledge_source_page`);
    try {
      const page = await db.listOrgKnowledgeSources(organizationId, { kinds: ["file"], pageSize: 3 });
      expect(page.items).toHaveLength(3);
      expect(page.total).toBe(60);
    } finally {
      await pg.exec("alter function public.hidden_knowledge_source_page(uuid, text[], text, text, text, bigint, bigint) rename to get_org_knowledge_source_page");
    }
    await pg.exec(`revoke execute on function ${RPC_SIGNATURE} from authenticated`);
    await pg.exec("set role authenticated");
    try {
      await expect(db.listOrgKnowledgeSources(organizationId, { kinds: ["file"] })).rejects.toMatchObject({ code: "42501" });
    } finally {
      await pg.exec("reset role");
      await pg.exec(`grant execute on function ${RPC_SIGNATURE} to authenticated`);
    }
  });
});
