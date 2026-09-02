import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createSchemaLoadedPglite } from "./supabase-contract-harness";

/**
 * Who may read, and who may never write, the two audit ledgers (#801, CYB-05
 * and CYB-12): `object_access_events` and `retention_sweep_events`.
 *
 * Both migrations add one policy, "admins read", and no insert, update or
 * delete policy at all: the service role writes, nobody edits. The pglite
 * contract tests connect as a superuser and walk straight past every policy,
 * so until this file the admin-only read and the append-only posture were
 * asserted nowhere (supabase/CLAUDE.md: a policy no test switches role for is
 * unasserted). Modelled on channel-access.test.ts: grant what Supabase grants
 * out of band, then ask as `authenticated` with the caller's id in the claim.
 */

let pg: PGlite;
let orgId: string;
let admin: string;
let editor: string;
let foreignAdmin: string;

async function seedUser(email: string, organization: string, role: string): Promise<string> {
  const id = randomUUID();
  await pg.query(
    `insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, '{}')`,
    [id, email]
  );
  await pg.query(
    `insert into public.organization_members (organization_id, user_id, role)
     values ($1, $2, $3)`,
    [organization, id, role]
  );
  return id;
}

/** Run one statement the way PostgREST does: as `authenticated`, as this user. */
async function actingAs<Row>(
  userId: string,
  sql: string,
  params: unknown[] = []
): Promise<Row[]> {
  await pg.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId]);
  await pg.exec("set role authenticated");
  try {
    return (await pg.query<Row>(sql, params)).rows;
  } finally {
    await pg.exec("reset role");
  }
}

const countOf = async (table: string) =>
  Number(
    (await pg.query<{ count: string | number }>(`select count(*) as count from public.${table}`))
      .rows[0]!.count
  );

beforeAll(async () => {
  pg = await createSchemaLoadedPglite();
  orgId = randomUUID();
  const foreignOrg = randomUUID();
  await pg.query(`insert into public.organizations (id, name) values ($1, 'Ledger U'), ($2, 'Other U')`, [
    orgId,
    foreignOrg,
  ]);
  admin = await seedUser("admin@ledger-test.edu", orgId, "admin");
  editor = await seedUser("editor@ledger-test.edu", orgId, "editor");
  foreignAdmin = await seedUser("admin@other-test.edu", foreignOrg, "admin");

  // Supabase grants these to `authenticated` out of band, so the migrations
  // never mention them; without them `set role authenticated` fails on
  // privileges before RLS is ever consulted, and the policies go untested.
  await pg.exec(`
    grant usage on schema public to authenticated;
    grant usage on schema private to authenticated;
    grant select, insert, update, delete
      on all tables in schema public to authenticated;
  `);

  // Written the way production writes them: by the service role, which is a
  // superuser here and bypasses RLS, as the real one does.
  await pg.query(
    `insert into public.object_access_events
       (organization_id, actor_kind, actor_id, object_kind, object_path, result, bytes, ip)
     values ($1, 'member', $2, 'knowledge_original', 'org/handbook.pdf', 'served', 4096, '203.0.113.7'),
            ($1, 'visitor', 'v-1', 'knowledge_original', 'org/private.pdf', 'refused', null, '198.51.100.9'),
            ($1, 'member', $2, 'knowledge_original', 'org/handbook.pdf', 'aborted', 1024, '203.0.113.7')`,
    [orgId, editor]
  );
  await pg.query(
    `insert into public.retention_sweep_events
       (organization_id, policy, retention_days, cutoff, deleted)
     values ($1, 'transcripts', 30, now(), 2)`,
    [orgId]
  );
}, 120_000);

afterAll(async () => {
  await pg?.close();
});

describe.each([
  { table: "object_access_events", seeded: 3 },
  { table: "retention_sweep_events", seeded: 1 },
])("$table", ({ table, seeded }) => {
  it("is readable by an admin of the organization", async () => {
    const rows = await actingAs<{ organization_id: string }>(
      admin,
      `select organization_id from public.${table}`
    );
    expect(rows).toHaveLength(seeded);
    expect(rows.every((row) => row.organization_id === orgId)).toBe(true);
  });

  it("is invisible to an editor, even one the rows are about", async () => {
    // The editor's own downloads are on the ledger; reading the ledger is
    // still an administrative act, so they see nothing, not "their" rows.
    expect(await actingAs(editor, `select id from public.${table}`)).toHaveLength(0);
  });

  it("is invisible to an admin of another organization", async () => {
    expect(await actingAs(foreignAdmin, `select id from public.${table}`)).toHaveLength(0);
  });

  it("refuses an insert from an admin: a member must not write their own audit trail", async () => {
    const insert =
      table === "object_access_events"
        ? `insert into public.object_access_events
             (organization_id, actor_kind, object_kind, object_path, result)
           values ($1, 'member', 'knowledge_original', 'org/forged.pdf', 'served')`
        : `insert into public.retention_sweep_events
             (organization_id, policy, retention_days, cutoff, deleted)
           values ($1, 'transcripts', 1, now(), 0)`;
    await expect(actingAs(admin, insert, [orgId])).rejects.toThrow(/row-level security/i);
    expect(await countOf(table)).toBe(seeded);
  });

  it("lets nobody rewrite or erase history: update and delete touch no row", async () => {
    // No update or delete policy exists, so RLS shows these commands no rows.
    // Asserted as "nothing changed" rather than "it threw", which is how
    // PostgREST would report it too.
    const column = table === "object_access_events" ? "result" : "policy";
    const value = table === "object_access_events" ? "'failed'" : "'traces'";
    await actingAs(admin, `update public.${table} set ${column} = ${value}`);
    await actingAs(admin, `delete from public.${table}`);
    expect(await countOf(table)).toBe(seeded);
    const rewritten = await pg.query<{ count: string | number }>(
      `select count(*) as count from public.${table} where ${column} = ${value}`
    );
    expect(Number(rewritten.rows[0]!.count)).toBe(0);
  });
});

describe("the aborted outcome (#801 review, CYB-05)", () => {
  it("is accepted by the widened check constraint, and `failed` still is too", async () => {
    // The constraint widened in 20260902100000; a chain that lost that file
    // would refuse the row the download proxy now writes on a client cancel.
    for (const result of ["served", "aborted", "refused", "failed"]) {
      await expect(
        pg.query(
          `insert into public.object_access_events
             (organization_id, actor_kind, object_kind, object_path, result)
           values ($1, 'unknown', 'analytics_export', 'export/x', $2)`,
          [orgId, result]
        )
      ).resolves.toBeTruthy();
    }
    await expect(
      pg.query(
        `insert into public.object_access_events
           (organization_id, actor_kind, object_kind, object_path, result)
         values ($1, 'unknown', 'analytics_export', 'export/x', 'cancelled')`,
        [orgId]
      )
    ).rejects.toThrow(/check/i);
  });
});
