import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createSupabaseDb } from "../supabase";
import type { Db } from "../types";
import { createPgliteSupabaseClient } from "./postgrest-shim";
import { createSchemaLoadedPglite } from "./supabase-contract-harness";
let pg: PGlite;
let db: Db;
let org: string;
const user = randomUUID();
beforeAll(async () => {
  pg = await createSchemaLoadedPglite();
  await pg.query("insert into auth.users(id,email,raw_user_meta_data) values ($1,'quality@example.com','{}')", [user]);
  await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  db = createSupabaseDb(createPgliteSupabaseClient(pg, { id: user, email: "quality@example.com" }));
  org = await db.createOrganization("Knowledge quality");
}, 180_000);
afterAll(async () => { await pg?.close(); });
it("keeps only fifty append-only FAQ versions and refuses Member updates and deletes", async () => {
  const assistant = await db.createAssistant(org, { title: "Quality" });
  const collection = await db.createCollection(assistant.id, { name: "FAQ history" });
  const source = await db.createSource({ collectionId: collection.id, name: "Question", kind: "faq", config: {} });
  const concept = await db.createConcept({ collectionId: collection.id, sourceId: source.id, path: "faq/history.md", frontmatter: { type: "FAQ", title: "Question" }, body: "Answer 0" });
  await db.setDocumentReview(org, { documentId: concept.id, memberId: user, reviewed: true });
  for (let version = 1; version <= 53; version++) await db.updateConcept(concept.id, { frontmatter: { type: "FAQ", title: "Question", generated: { by: "human:" + user, at: `version-${version}` } }, body: `Answer ${version}` });
  const history = await db.table("faqHistory").list({ sourceId: source.id });
  expect(history).toHaveLength(50);
  expect(history.map(row => row.answer)).not.toContain("Answer 0");
  expect(history.map(row => row.answer)).toContain("Answer 52");
  expect((await db.getConcept(concept.id))?.frontmatter.verified).toBeUndefined();
  await pg.exec("grant usage on schema public,private to authenticated; set role authenticated");
  try {
    await expect(pg.query("update public.faq_history set answer='rewritten' where source_id=$1", [source.id])).rejects.toThrow(/permission denied/i);
    await expect(pg.query("delete from public.faq_history where source_id=$1", [source.id])).rejects.toThrow(/permission denied/i);
    expect((await pg.query("select id from public.faq_history where source_id=$1", [source.id])).rows).toHaveLength(50);
  } finally { await pg.exec("reset role"); }
  await db.deleteSource(source.id);
  expect(await db.table("faqHistory").list({ sourceId: source.id })).toEqual([]);
});

it("measures the bounded usage read with 2,000 Sources and 20,000 answers", async () => {
  const assistant = await db.createAssistant(org, { title: "Usage seed" });
  const collection = await db.createCollection(assistant.id, { name: "Usage seed" });
  const conversation = await db.createConversation({ assistantId: assistant.id, subjectType: "visitor", subjectId: "seed" });
  await pg.query("insert into public.sources(id,collection_id,name,kind,config) select 'usage-seed-'||n,$1,'Source '||n,'faq','{}' from generate_series(1,2000) n", [collection.id]);
  await pg.query("insert into public.messages(id,conversation_id,role,content) select 'usage-answer-'||n,$1,'assistant',jsonb_build_array(jsonb_build_object('type','sources','sources',jsonb_build_array(jsonb_build_object('sourceId','usage-seed-'||((n%2000)+1))))) from generate_series(1,20000) n", [conversation.id]);
  const started = performance.now();
  const report = await db.getSourceUsage(org, new Date(Date.now() + 1000).toISOString());
  const durationMs = performance.now() - started;
  const seed = report.filter(row => row.sourceId.startsWith("usage-seed-"));
  expect(seed).toHaveLength(2000);
  expect(seed.every(row => row.cited30 === 10 && !row.unused90)).toBe(true);
  const measurement = { measurement: "source-usage", sources: 2000, answers: 20000, durationMs: Math.round(durationMs) };
  writeFileSync(join(tmpdir(), "ciele-source-usage-measurement.json"), JSON.stringify(measurement));
}, 60_000);


it("keeps Library and Document reads working one migration behind", async () => {
  const legacy = await createSchemaLoadedPglite({ stopBefore: "20261022200000_knowledge_quality.sql" });
  try {
    const member = randomUUID();
    await legacy.query("insert into auth.users(id,email,raw_user_meta_data) values ($1,'lag-quality@example.com','{}')", [member]);
    await legacy.query("select set_config('request.jwt.claim.sub',$1,false)", [member]);
    const previous = createSupabaseDb(createPgliteSupabaseClient(legacy, { id: member, email: "lag-quality@example.com" }));
    const organizationId = await previous.createOrganization("Previous schema");
    const assistant = await previous.createAssistant(organizationId, { title: "Previous schema" });
    const collection = await previous.createCollection(assistant.id, { name: "Old knowledge" });
    const source = await previous.createSource({ collectionId: collection.id, name: "Legacy FAQ", kind: "faq", config: {} });
    const document = await previous.createConcept({ collectionId: collection.id, sourceId: source.id, path: "faq/legacy.md", frontmatter: { type: "FAQ", title: "Legacy question" }, body: "Legacy answer" });
    const page = await previous.listSourceDocuments(source.id, { trustTier: "human-reviewed" });
    expect(page.items.map(row => row.id)).toContain(document.id);
    expect(page.qualityAvailable).toBe(false);
    expect((await previous.listOrgKnowledgeSources(organizationId, { kinds: ["faq"] })).items.map(row => row.id)).toContain(source.id);
  } finally { await legacy.close(); }
}, 180_000);


it("limits lexical and vector candidate lookup to FAQ Sources before ranking", async () => {
  const assistant = await db.createAssistant(org, { title: "FAQ-only retrieval" });
  const collection = await db.createCollection(assistant.id, { name: "Mixed FAQ collection" });
  for (let index = 0; index < 32; index++) {
    const source = await db.createSource({ collectionId: collection.id, name: "Reset password", kind: index === 31 ? "faq" : "file", config: {} });
    const concept = await db.createConcept({ collectionId: collection.id, sourceId: source.id, path: `${source.id}.md`, frontmatter: { type: index === 31 ? "FAQ" : "Document", title: "Reset password" }, body: "Reset password" });
    await db.saveChunks([{ collectionId: collection.id, conceptId: concept.id, sourceId: source.id, content: "Reset password", embedding: [1, ...Array(1535).fill(0)] }]);
  }
  const lexical = await db.searchCollectionChunks(org, [collection.id], { faqOnly: true, text: "Reset password", embedding: null, limit: 30 });
  expect(lexical).toHaveLength(1);
  const vector = await db.searchCollectionChunks(org, [collection.id], { faqOnly: true, text: "Reset password", embedding: [1, ...Array(1535).fill(0)], limit: 30 });
  expect(vector).toHaveLength(1);
  expect((await db.getSource(vector[0].sourceId!))?.kind).toBe("faq");
});
