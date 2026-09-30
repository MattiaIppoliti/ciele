import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createSchemaLoadedPglite } from "./supabase-contract-harness";

/**
 * `20260929150000_ciele_ai` replaces the unnamed `system_kind` check by looking
 * its name up. A lookup that found nothing would leave the old check in place
 * and refuse every Ciele AI row, so the values are asserted against the chain.
 */

let pg: PGlite;
let orgId: string;
let ownerId: string;

beforeAll(async () => {
  pg = await createSchemaLoadedPglite();
  orgId = randomUUID();
  ownerId = randomUUID();
  await pg.query(`insert into public.organizations (id, name) values ($1, 'Ciele AI Org')`, [orgId]);
  await pg.query(`insert into auth.users (id, email) values ($1, 'owner@example.test')`, [ownerId]);
}, 120_000);

afterAll(async () => {
  await pg?.close();
});

const insert = (kind: string) =>
  pg.query(
    `insert into public.teammates (id, organization_id, owner_id, name, system_kind)
     values ($1, $2, $3, 'Ciele AI', $4)`,
    [randomUUID(), orgId, ownerId, kind]
  );

describe("the Ciele AI schema", () => {
  it("accepts the kind, once per Organization", async () => {
    await expect(insert("ciele_ai")).resolves.toBeTruthy();
    await expect(insert("ciele_ai")).rejects.toThrow(/teammates_ciele_ai_uidx/);
  });

  it("still refuses a kind nobody declared", async () => {
    await expect(insert("something_else")).rejects.toThrow(/teammates_system_kind_check/);
  });
});
