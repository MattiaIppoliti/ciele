import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createSchemaLoadedPglite } from "./supabase-contract-harness";

/**
 * Turn concurrency leases are the service role's alone
 * (`20260926120000_turn_concurrency_leases.sql`). A Visitor's browser holds the
 * anon key and a Member's holds an `authenticated` JWT; either one taking or
 * releasing slots could starve every widget on the deployment, or free slots
 * it never held. The contract suite connects as a superuser and walks past all
 * of this, so it is asserted here, the way `ledger-access.security.test.ts`
 * does: grant what Supabase grants out of band, then ask as `authenticated`.
 */

let pg: PGlite;

async function asServiceRole<Row>(sql: string, params: unknown[] = []): Promise<Row[]> {
  await pg.query(`select set_config('request.jwt.claim.role', 'service_role', false)`);
  try {
    return (await pg.query<Row>(sql, params)).rows;
  } finally {
    await pg.query(`select set_config('request.jwt.claim.role', '', false)`);
  }
}

async function asAuthenticated<Row>(sql: string, params: unknown[] = []): Promise<Row[]> {
  await pg.exec("set role authenticated");
  try {
    return (await pg.query<Row>(sql, params)).rows;
  } finally {
    await pg.exec("reset role");
  }
}

const ACQUIRE = `select public.acquire_turn_concurrency(
  array['org:access-test'], array[5], now(), now() + interval '5 minutes'
) as lease`;

beforeAll(async () => {
  pg = await createSchemaLoadedPglite();
  await pg.exec(`
    grant usage on schema public to authenticated;
    grant usage on schema private to authenticated;
    grant select, insert, update, delete
      on all tables in schema public to authenticated;
  `);
});

afterAll(async () => {
  await pg.close();
});

describe("turn concurrency leases", () => {
  it("lets the service role take and give back a slot", async () => {
    const [row] = await asServiceRole<{ lease: string | null }>(ACQUIRE);
    expect(row?.lease).toBeTruthy();
    const [released] = await asServiceRole<{ released: boolean }>(
      `select public.release_turn_concurrency($1) as released`,
      [row!.lease]
    );
    expect(released?.released).toBe(true);
  });

  it("refuses an authenticated caller the functions outright", async () => {
    await expect(asAuthenticated(ACQUIRE)).rejects.toThrow(/permission denied/);
    await expect(
      asAuthenticated(`select public.release_turn_concurrency(gen_random_uuid())`)
    ).rejects.toThrow(/permission denied/);
  });

  it("refuses a non-service claim even where EXECUTE is held", async () => {
    // The superuser still owns EXECUTE, so this reaches the function body and
    // proves the in-function role check, not only the grant.
    await expect(pg.query(ACQUIRE)).rejects.toThrow(/requires service role/);
  });

  it("hides the table from authenticated reads and refuses its writes", async () => {
    const [held] = await asServiceRole<{ lease: string }>(ACQUIRE);
    expect(held?.lease).toBeTruthy();
    await expect(
      asAuthenticated(`select * from public.turn_concurrency_leases`)
    ).resolves.toEqual([]);
    await expect(
      asAuthenticated(
        `insert into public.turn_concurrency_leases (lease_id, scope_key, expires_at)
         values (gen_random_uuid(), 'org:access-test', now() + interval '1 hour')`
      )
    ).rejects.toThrow(/row-level security/);
    await expect(
      asAuthenticated(`delete from public.turn_concurrency_leases returning lease_id`)
    ).resolves.toEqual([]);
    await asServiceRole(`select public.release_turn_concurrency($1)`, [held!.lease]);
  });
});
