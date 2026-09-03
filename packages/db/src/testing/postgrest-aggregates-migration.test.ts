import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createSchemaLoadedPglite } from "./supabase-contract-harness";

/**
 * The PostgREST aggregates migration on a database that is not the
 * supabase/postgres image (#810, bring-your-own Postgres).
 *
 * `alter role authenticator set pgrst.*` writes a placeholder GUC onto a role.
 * Stock Postgres lets only a superuser (or a role granted SET on that
 * parameter) do that; the image gets away with it because supautils allows
 * `pgrst.*` for its privileged role. A managed Postgres has no supautils and no
 * superuser, so the statement is refused and, unguarded, the whole chain stops
 * at this file. The compose already passes the same option to PostgREST as an
 * environment variable, so the migration only needs to *try*.
 */

const MIGRATION = fileURLToPath(
  new URL(
    "../../../../supabase/migrations/20260902090000_postgrest_aggregates.sql",
    import.meta.url
  )
);

let pg: PGlite;
const runMigration = () => pg.exec(readFileSync(MIGRATION, "utf8"));

beforeAll(async () => {
  // The chain up to (not including) this file, as the harness ships it: no
  // `authenticator` role, so the migration's role guard has been a no-op here.
  pg = await createSchemaLoadedPglite({
    stopBefore: "20260902090000_postgrest_aggregates.sql",
  });
  // What a managed provider hands out: an admin that may create roles but is
  // no superuser, plus the PostgREST login role the provisioner creates.
  // The admin creates the login role itself (so it holds ADMIN OPTION on it,
  // as the provisioner's admin does); what is left to refuse is the GUC.
  await pg.exec(`
    create role provider_admin login nosuperuser createrole createdb;
    grant create on database postgres to provider_admin;
    set role provider_admin;
    create role authenticator login noinherit;
    reset role;
  `);
}, 120_000);

afterAll(async () => {
  await pg?.close();
});

describe("postgrest aggregates migration on a non-superuser database (#810)", () => {
  it("applies as a superuser and records the role setting (the image's path)", async () => {
    await runMigration();
    const { rows } = await pg.query<{ setconfig: string[] }>(
      `select s.setconfig from pg_db_role_setting s
         join pg_roles r on r.oid = s.setrole
        where r.rolname = 'authenticator'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].setconfig).toContain("pgrst.db_aggregates_enabled=true");
    await pg.exec(`alter role authenticator reset pgrst.db_aggregates_enabled`);
  });

  it("does not fail the chain when the connecting role may not set a placeholder GUC", async () => {
    await pg.exec(`set role provider_admin`);
    try {
      // The refusal is the point: the statement must be attempted and the
      // migration must still complete, or a managed Postgres never gets past
      // this file.
      await expect(runMigration()).resolves.not.toThrow();
    } finally {
      await pg.exec(`reset role`);
    }
  });
});
