import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { Db } from "../types";
import { createSupabaseDb } from "../supabase";
import { createPgliteSupabaseClient } from "./postgrest-shim";
import { createSchemaLoadedPglite } from "./supabase-contract-harness";

/**
 * The deploy serves against a database one migration behind (#801 review):
 * a Vercel deploy is live minutes before the CI migrate job runs, and longer
 * if `verify` fails. Every read of a column or RPC signature that #801 added
 * has to work against the schema as it was before #801, or the console 500s
 * on every signed-in request for that window (`getCurrentOrg` runs on all of
 * them) and ingestion and retrieval both break.
 *
 * So this boots the chain *stopped before* the first #801 schema change and
 * drives the real adapter against it. The pre-migration behaviour is the
 * fallback: the new column reads as null, chunks save without a space and the
 * matchers are called with their old signature. The one write that cannot
 * silently fall back, a legal hold nobody would honour, refuses readably.
 */

let pg: PGlite;
let db: Db;
let organizationId: string;

beforeAll(async () => {
  pg = await createSchemaLoadedPglite({
    stopBefore: "20260830130000_transcript_retention.sql",
  });
  const userId = randomUUID();
  await pg.query(
    `insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, '{}')`,
    [userId, "owner@lag-test.edu"]
  );
  await pg.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId]);
  db = createSupabaseDb(
    createPgliteSupabaseClient(pg, { id: userId, email: "owner@lag-test.edu" })
  );
  organizationId = await db.createOrganization("Lagging Org");
}, 120_000);

afterAll(async () => {
  await pg?.close();
});

describe("against a schema without the #801 columns and signatures", () => {
  it("still resolves the current organization, with the new window unset", async () => {
    const current = await db.getCurrentOrg(organizationId);
    expect(current?.organization).toMatchObject({
      id: organizationId,
      name: "Lagging Org",
      transcriptRetentionDays: null,
    });
    expect((await db.listOrganizations()).map((org) => org.id)).toContain(organizationId);
  });

  it("saves a rename, and refuses a retention window it cannot record", async () => {
    const renamed = await db.updateOrganization(organizationId, { name: "Renamed" });
    expect(renamed.name).toBe("Renamed");
    expect(renamed.transcriptRetentionDays).toBeNull();
    await expect(
      db.updateOrganization(organizationId, { transcriptRetentionDays: 30 })
    ).rejects.toThrow(/temporarily unavailable/);
  });

  it("has no transcript policies to sweep, and the sweep primitive deletes nothing", async () => {
    expect(await db.listTranscriptRetentionPolicies()).toEqual([]);
    expect(
      await db.deleteExpiredConversations(organizationId, new Date().toISOString())
    ).toBe(0);
  });

  it("saves chunks without the space column and searches with the old RPC signature", async () => {
    const assistant = await db.createAssistant(organizationId, { title: "Lag Fixture" });
    const collection = await db.createCollection(assistant.id, { name: "K" });
    const source = await db.createSource({
      collectionId: collection.id,
      name: "lag.md",
      kind: "file",
    });
    const concept = await db.createConcept({
      collectionId: collection.id,
      sourceId: source.id,
      path: "lag.md",
      frontmatter: { type: "Note", title: "Lag" },
      body: "content",
    });
    await db.setSourceAssistantLinks(source.id, [assistant.id]);

    const axis = new Array(1536).fill(0);
    axis[0] = 1;
    // The adapter stamps the space; the database has no column for it yet.
    await expect(
      db.saveChunks([
        {
          conceptId: concept.id,
          collectionId: collection.id,
          sourceId: source.id,
          content: "lagging chunk",
          embedding: axis,
          embeddingSpace: "openai:text-embedding-3-small",
        },
      ])
    ).resolves.toBeUndefined();

    // "xyzzy" matches nothing lexically, so the hit came off the vector RPC,
    // which the old schema only has in its four-argument form.
    const query = {
      text: "xyzzy",
      embedding: axis,
      limit: 6,
      embeddingSpace: "openai:text-embedding-3-small",
    };
    expect(
      (await db.searchChunks(assistant.id, collection.id, query)).map((hit) => hit.content)
    ).toContain("lagging chunk");
    expect(
      (await db.searchCollectionChunks(organizationId, [collection.id], query)).map(
        (hit) => hit.content
      )
    ).toContain("lagging chunk");
    expect(
      (await db.searchSourceChunks(organizationId, [source.id], query)).map(
        (hit) => hit.content
      )
    ).toContain("lagging chunk");
  });

  it("refuses a legal hold rather than pretending one took", async () => {
    const assistant = await db.createAssistant(organizationId, { title: "Hold Fixture" });
    const conversation = await db.createConversation({
      assistantId: assistant.id,
      subjectType: "visitor",
      subjectId: "v-lag",
      title: "held?",
    });
    await expect(db.setConversationLegalHold(conversation.id, true)).rejects.toThrow(
      /temporarily unavailable/
    );
  });
});
