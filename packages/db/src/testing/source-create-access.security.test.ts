import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createSchemaLoadedPglite } from "./supabase-contract-harness";

let pg: PGlite;
let organizationId: string;
let collectionId: string;
let editorId: string;
let viewerId: string;
let outsiderId: string;

async function actingAs(userId: string, sql: string, params: unknown[] = []) {
  await pg.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await pg.exec("set role authenticated");
  try {
    return await pg.query(sql, params);
  } finally {
    await pg.exec("reset role");
  }
}

beforeAll(async () => {
  pg = await createSchemaLoadedPglite();
  organizationId = randomUUID();
  const otherOrganizationId = randomUUID();
  collectionId = "source-create-collection";
  editorId = randomUUID();
  viewerId = randomUUID();
  outsiderId = randomUUID();
  await pg.query(
    "insert into public.organizations (id, name) values ($1, 'Owner'), ($2, 'Other')",
    [organizationId, otherOrganizationId],
  );
  for (const [id, role] of [[editorId, "editor"], [viewerId, "viewer"]]) {
    await pg.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id}@example.edu`]);
    await pg.query(
      "insert into public.organization_members (organization_id, user_id, role) values ($1, $2, $3)",
      [organizationId, id, role],
    );
  }
  await pg.query("insert into auth.users (id, email) values ($1, $2)", [outsiderId, `${outsiderId}@example.edu`]);
  await pg.query(
    "insert into public.organization_members (organization_id, user_id, role) values ($1, $2, 'editor')",
    [otherOrganizationId, outsiderId],
  );
  await pg.query(
    "insert into public.knowledge_collections (id, organization_id, name) values ($1, $2, 'Library')",
    [collectionId, organizationId],
  );
  await pg.query(
    "insert into public.sources (id, collection_id, name, kind) values ('source-visible-unlinked', $1, 'Existing', 'website')",
    [collectionId],
  );
  await pg.exec(`
    grant usage on schema public, private to authenticated;
    grant select, insert on all tables in schema public to authenticated;
  `);
}, 120_000);

afterAll(async () => { await pg?.close(); });

describe("Source creation under authenticated RLS", () => {
  it("accepts the same editor insert without RETURNING", async () => {
    await expect(actingAs(
      editorId,
      "insert into public.sources (id, collection_id, name, kind) values ('source-create-no-return', $1, 'Website', 'website')",
      [collectionId],
    )).resolves.toBeTruthy();
  });

  it("lets an editor create and return a new unlinked Website Source", async () => {
    const result = await actingAs(
      editorId,
      "insert into public.sources (id, collection_id, name, kind) values ('source-create-website', $1, 'Website', 'website') returning id",
      [collectionId],
    );
    expect(result.rows).toEqual([{ id: "source-create-website" }]);
  });

  it("lets organization members read an unlinked Source without exposing it to outsiders", async () => {
    const query = "select id from public.sources where id = 'source-visible-unlinked'";
    expect((await actingAs(viewerId, query)).rows).toEqual([{ id: "source-visible-unlinked" }]);
    expect((await actingAs(outsiderId, query)).rows).toEqual([]);
  });

  it("still refuses viewers and editors from another Organization", async () => {
    for (const userId of [viewerId, outsiderId]) {
      await expect(actingAs(
        userId,
        "insert into public.sources (id, collection_id, name, kind) values ($1, $2, 'Denied', 'website') returning id",
        [randomUUID(), collectionId],
      )).rejects.toThrow(/row-level security policy/);
    }
  });
});
