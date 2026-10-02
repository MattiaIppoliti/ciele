import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createSchemaLoadedPglite } from "./supabase-contract-harness";

let pg: PGlite;
beforeAll(async () => { pg = await createSchemaLoadedPglite(); }, 120_000);
afterAll(async () => { await pg?.close(); });

describe("message reaction storage access", () => {
  for (const role of ["anon", "authenticated"]) {
    it(`refuses direct ${role} reads and writes`, async () => {
      await pg.exec(`set role ${role}`);
      try {
        await expect(pg.query("select * from public.message_reactions")).rejects.toThrow(/permission denied/);
        await expect(pg.query("delete from public.message_reactions")).rejects.toThrow(/permission denied/);
      } finally { await pg.exec("reset role"); }
    });
  }
  it("enables RLS and gives the verified server role access", async () => {
    const result = await pg.query<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class where oid = 'public.message_reactions'::regclass");
    expect(result.rows[0]?.relrowsecurity).toBe(true);
    await pg.exec("set role service_role");
    try { await expect(pg.query("select * from public.message_reactions")).resolves.toMatchObject({ rows: [] }); }
    finally { await pg.exec("reset role"); }
  });
});
