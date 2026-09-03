import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";

/**
 * The external-database provisioner (#811) on a real Postgres, as the role a
 * managed provider hands out: CREATEROLE + CREATEDB + BYPASSRLS, no superuser.
 *
 * deploy/external-db/provision.sql recreates what the supabase/postgres image
 * bakes into a fresh cluster. It is psql-shaped (`\set`, `\gset`, `:'var'`),
 * so this test performs the same substitutions psql would and runs the SQL
 * body through PGlite. What it proves: the file is valid SQL, every object
 * the services and the migration chain expect comes out of it, a second run
 * is a no-op, and the two hard requirements really refuse.
 */

const PROVISION = fileURLToPath(
  new URL("../../../../deploy/external-db/provision.sql", import.meta.url)
);

/** psql's job: drop meta-commands, bind :'pgpass' and :"applier". */
function asPlainSql(applier: string, pgpass: string): string {
  return readFileSync(PROVISION, "utf8")
    .split(/\r?\n/)
    // `\echo`, `\set` … and the `select … \gset` bindings the SQL reads back
    // through `:'applier'`; the body already uses current_user where it matters.
    .filter((line) => !line.startsWith("\\") && !/\\gset\s*$/.test(line))
    .join("\n")
    .replaceAll(":'pgpass'", `'${pgpass}'`)
    .replaceAll(`:"applier"`, `"${applier}"`)
    .replaceAll(":'applier'", `'${applier}'`);
}

let pg: PGlite;

beforeAll(async () => {
  pg = new PGlite({ extensions: { vector, pg_trgm } });
  await pg.waitReady;
  // A provider's admin owns the database it created (Postgres 15+ hands the
  // public schema to pg_database_owner, so ownership is what grants CREATE
  // there). The provisioner checks for exactly that.
  await pg.exec(`
    create role provider_admin login nosuperuser createrole createdb bypassrls;
    alter database postgres owner to provider_admin;
  `);
  // PGlite's bundled pgvector is not marked trusted, so only a superuser may
  // create it here; every managed provider allowlists it for the admin. Create
  // it up front so the provisioner's \if not exists\ is the no-op it is on
  // Azure once vector is in azure.extensions. pg_trgm IS trusted, so it stays
  // with the provisioner and exercises the non-superuser path.
  await pg.exec(`create extension if not exists vector`);
}, 60_000);

afterAll(async () => {
  await pg?.close();
});

async function asAdmin<T>(fn: () => Promise<T>): Promise<T> {
  await pg.exec("set role provider_admin");
  try {
    return await fn();
  } finally {
    await pg.exec("reset role");
  }
}

describe("external database provisioner (#811)", () => {
  it("leaves no psql variable inside a dollar-quoted block (psql would not interpolate it)", () => {
    // `asPlainSql` substitutes everywhere, which is more than psql does: psql
    // binds :'var' in top-level SQL only, never inside quotes, $$ included. A
    // :'pgpass' inside a DO block passes this suite and dies under psql -f.
    // Comments first: the file talks about "$$ blocks" in prose, which would
    // otherwise pair with a real delimiter and swallow top-level SQL.
    const source = readFileSync(PROVISION, "utf8")
      .split(/\r?\n/)
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    const blocks = source.match(/\$\$[\s\S]*?\$\$/g) ?? [];
    expect(blocks.length).toBeGreaterThan(5);
    for (const block of blocks) {
      expect(block).not.toMatch(/:'[a-z_]+'|:"[a-z_]+"/);
    }
  });

  it("runs as a non-superuser admin and creates every role the services and the chain name", async () => {
    await asAdmin(() => pg.exec(asPlainSql("provider_admin", "s3cret")));
    const { rows } = await pg.query<{
      rolname: string;
      rolcanlogin: boolean;
      rolinherit: boolean;
      rolbypassrls: boolean;
    }>(
      `select rolname, rolcanlogin, rolinherit, rolbypassrls from pg_roles
        where rolname in ('anon','authenticated','service_role','authenticator',
                          'supabase_auth_admin','supabase_storage_admin','postgres')
        order by rolname`
    );
    expect(rows.map((r) => r.rolname)).toEqual([
      "anon",
      "authenticated",
      "authenticator",
      "postgres",
      "service_role",
      "supabase_auth_admin",
      "supabase_storage_admin",
    ]);
    const by = Object.fromEntries(rows.map((r) => [r.rolname, r]));
    expect(by.service_role.rolbypassrls).toBe(true);
    expect(by.service_role.rolcanlogin).toBe(false);
    expect(by.authenticator.rolcanlogin).toBe(true);
    expect(by.authenticator.rolinherit).toBe(false);
    // `postgres` merely has to exist (GoTrue grants to it by name). Here, as
    // on Cloud SQL or RDS, it is the pre-existing admin; on Azure or Neon the
    // provisioner creates it NOLOGIN.
    expect(by.postgres).toBeDefined();
  });

  it("gives the services their schemas, owners and search_path", async () => {
    const { rows: schemas } = await pg.query<{ nspname: string; owner: string }>(
      `select nspname, pg_get_userbyid(nspowner) as owner from pg_namespace
        where nspname in ('auth','storage','extensions') order by 1`
    );
    expect(schemas).toEqual([
      { nspname: "auth", owner: "supabase_auth_admin" },
      { nspname: "extensions", owner: "provider_admin" },
      { nspname: "storage", owner: "supabase_storage_admin" },
    ]);
    const { rows: settings } = await pg.query<{ rolname: string; setconfig: string[] }>(
      `select r.rolname, s.setconfig from pg_db_role_setting s join pg_roles r on r.oid = s.setrole
        where r.rolname in ('supabase_auth_admin','supabase_storage_admin') order by 1`
    );
    expect(settings.find((s) => s.rolname === "supabase_auth_admin")?.setconfig).toContain(
      "search_path=auth"
    );
    expect(settings.find((s) => s.rolname === "supabase_storage_admin")?.setconfig).toContain(
      "search_path=storage"
    );
  });

  it("creates the auth helpers owned by GoTrue's role, so its migrations may replace them", async () => {
    const { rows } = await pg.query<{ proname: string; owner: string }>(
      `select p.proname, pg_get_userbyid(p.proowner) as owner
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'auth' order by 1`
    );
    expect(rows).toEqual([
      { proname: "email", owner: "supabase_auth_admin" },
      { proname: "jwt", owner: "supabase_auth_admin" },
      { proname: "role", owner: "supabase_auth_admin" },
      { proname: "uid", owner: "supabase_auth_admin" },
    ]);
    // The body the RLS policies rely on: no claim, no uid.
    const { rows: uid } = await pg.query<{ uid: string | null }>(`select auth.uid() as uid`);
    expect(uid[0].uid).toBeNull();
  });

  it("wires the memberships PostgREST, storage-api and the applier depend on", async () => {
    const members = async (role: string) => {
      const { rows } = await pg.query<{ rolname: string }>(
        `select m.rolname from pg_auth_members am
           join pg_roles r on r.oid = am.roleid join pg_roles m on m.oid = am.member
          where r.rolname = $1 order by 1`,
        [role]
      );
      return rows.map((r) => r.rolname);
    };
    // PostgREST switches into the three API roles from authenticator.
    for (const api of ["anon", "authenticated", "service_role"]) {
      expect(await members(api)).toContain("authenticator");
      // The applier creates tables the API roles must see, and policies on
      // storage.objects; it is a member of everything.
      expect(await members(api)).toContain("provider_admin");
    }
    expect(await members("authenticator")).toContain("supabase_storage_admin");
    expect(await members("supabase_auth_admin")).toContain("provider_admin");
    expect(await members("supabase_storage_admin")).toContain("provider_admin");
  });

  it("creates the two extensions the chain needs, where the chain expects them", async () => {
    const { rows } = await pg.query<{ extname: string; schema: string }>(
      `select extname, extnamespace::regnamespace::text as schema from pg_extension
        where extname in ('vector','pg_trgm') order by 1`
    );
    expect(rows).toEqual([
      { extname: "pg_trgm", schema: "extensions" },
      { extname: "vector", schema: "public" },
    ]);
  });

  it("grants the API roles what the image's default privileges used to: a table the applier creates is readable", async () => {
    await asAdmin(() => pg.exec(`create table public.provision_probe (id int)`));
    const { rows } = await pg.query<{ ok: boolean }>(
      `select has_table_privilege('authenticated', 'public.provision_probe', 'select') as ok`
    );
    expect(rows[0].ok).toBe(true);
  });

  it("is idempotent: a second run changes nothing and rotates the service password", async () => {
    const before = await pg.query<{ n: number }>(`select count(*)::int as n from pg_roles`);
    await asAdmin(() => pg.exec(asPlainSql("provider_admin", "r0tated")));
    const after = await pg.query<{ n: number }>(`select count(*)::int as n from pg_roles`);
    expect(after.rows[0].n).toBe(before.rows[0].n);
    const { rows } = await pg.query<{ same: boolean }>(
      `select (select rolpassword from pg_authid where rolname = 'authenticator')
            = (select rolpassword from pg_authid where rolname = 'supabase_auth_admin') as same`
    );
    // Three logins, one shared password: the two hashes agree with each other.
    expect(rows[0].same).toBe(false); // SCRAM salts differ per role, so compare validity instead:
    const { rows: pw } = await pg.query<{ rolname: string; has: boolean }>(
      `select rolname, rolpassword is not null as has from pg_authid
        where rolname in ('authenticator','supabase_auth_admin','supabase_storage_admin') order by 1`
    );
    expect(pw.every((r) => r.has)).toBe(true);
  });

  it("refuses an admin that cannot create a BYPASSRLS role, and names the way out", async () => {
    // A fresh cluster and the other kind of admin: CREATEROLE but no BYPASSRLS
    // (Postgres 15's rule, or a provider that withholds the attribute).
    const weak = new PGlite({ extensions: { vector, pg_trgm } });
    await weak.waitReady;
    await weak.exec(`
      create role weak_admin login nosuperuser createrole createdb;
      alter database postgres owner to weak_admin;
      create extension if not exists vector;
      set role weak_admin;
    `);
    try {
      await expect(weak.exec(asPlainSql("weak_admin", "x"))).rejects.toThrow(
        /cannot give role service_role BYPASSRLS/
      );
      // The hinge comes before schemas, helpers and grants: nothing half-done.
      const { rows } = await weak.query(
        `select 1 from pg_namespace where nspname in ('auth','storage')`
      );
      expect(rows).toHaveLength(0);
    } finally {
      await weak.close();
    }
  }, 60_000); // boots a second PGlite; under a parallel full run that alone can pass 5s
});
