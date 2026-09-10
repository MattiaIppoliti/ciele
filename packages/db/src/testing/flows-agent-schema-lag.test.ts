import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { Db } from "../types";
import { createSupabaseDb } from "../supabase";
import { createPgliteSupabaseClient } from "./postgrest-shim";
import { createSchemaLoadedPglite } from "./supabase-contract-harness";

/**
 * The deploy serves against a database one migration behind (supabase/CLAUDE.md).
 * The Flows Agent migration (#838) added `system_kind` and `assistant_id` to
 * `teammates`, and the generic accessor's defaults for that table always send
 * both. Before this test, every Teammate insert failed for the whole window
 * between the deploy going live and the migrate job landing, on a column the
 * database did not have yet.
 *
 * So this boots the chain *stopped before* that migration and inserts a
 * Teammate through the real adapter. A default whose value is null names a
 * column the database would fill itself, so the adapter retries without those
 * on a missing-column error; a caller who actually set one still gets the error,
 * because that value cannot be stored yet and pretending otherwise is worse.
 */

let pg: PGlite;
let db: Db;
let organizationId: string;
let userId: string;

beforeAll(async () => {
  pg = await createSchemaLoadedPglite({ stopBefore: "20260908120000_flows_agent.sql" });
  userId = randomUUID();
  await pg.query(
    `insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, '{}')`,
    [userId, "owner@flows-agent-lag.test"]
  );
  await pg.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId]);
  db = createSupabaseDb(
    createPgliteSupabaseClient(pg, { id: userId, email: "owner@flows-agent-lag.test" })
  );
  organizationId = await db.createOrganization("Lagging Org");
}, 120_000);

afterAll(async () => {
  await pg?.close();
});

describe("against a schema without the Flows Agent columns", () => {
  it("still creates an ordinary Teammate", async () => {
    const teammate = await db.table("teammates").insert({
      organizationId,
      ownerId: userId,
      name: "Ada",
      title: "Helps with onboarding",
      roleDescription: "Answers new colleagues.",
    });
    expect(teammate.name).toBe("Ada");
    expect((await db.table("teammates").get(teammate.id))?.name).toBe("Ada");
  });

  it("refuses a system Teammate it cannot record as one", async () => {
    await expect(
      db.table("teammates").insert({
        organizationId,
        ownerId: userId,
        name: "Flows Agent",
        systemKind: "flows_agent",
        assistantId: "a1",
      })
    ).rejects.toThrow();
  });
});
