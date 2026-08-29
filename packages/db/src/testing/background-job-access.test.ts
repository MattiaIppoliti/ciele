import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createSchemaLoadedPglite } from "./supabase-contract-harness";

let pg: PGlite;
let mine: string;
let foreign: string;
let member: string;

async function actingAs(
  userId: string,
  sql: string,
  params: unknown[] = []
): Promise<{ rows: unknown[] }> {
  await pg.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId]);
  await pg.query(`select set_config('request.jwt.claim.role', 'authenticated', false)`);
  await pg.exec("set role authenticated");
  try {
    return (await pg.query(sql, params)) as { rows: unknown[] };
  } finally {
    await pg.exec("reset role");
  }
}

beforeAll(async () => {
  pg = await createSchemaLoadedPglite();
  mine = randomUUID();
  foreign = randomUUID();
  member = randomUUID();
  await pg.query(
    `insert into auth.users (id, email) values ($1, 'jobs@access-test.edu')`,
    [member]
  );
  await pg.query(
    `insert into public.organizations (id, name)
     values ($1::uuid, 'Mine'), ($2::uuid, 'Foreign')`,
    [mine, foreign]
  );
  await pg.query(
    `insert into public.organization_members (organization_id, user_id, role)
     values ($1::uuid, $2::uuid, 'editor')`,
    [mine, member]
  );
  await pg.exec(`
    grant usage on schema public, private to authenticated;
    grant select, insert, update, delete on public.background_jobs to authenticated;
  `);
  await pg.query(
    `insert into public.background_jobs
       (id, organization_id, kind, payload)
     values
       ('job-mine', $1::uuid, 'promote_memories', jsonb_build_object('kind', 'promote_memories', 'organizationId', ($1::uuid)::text)),
       ('job-foreign', $2::uuid, 'promote_memories', jsonb_build_object('kind', 'promote_memories', 'organizationId', ($2::uuid)::text))`,
    [mine, foreign]
  );
}, 120_000);

afterAll(async () => {
  await pg?.close();
});

describe("background job tenancy under authenticated RLS", () => {
  it("shows source-less jobs only to members of the direct organization", async () => {
    const result = await actingAs(
      member,
      `select id from public.background_jobs order by id`
    );
    expect(result.rows).toEqual([{ id: "job-mine" }]);
  });

  it("refuses a source-less job stamped to another organization", async () => {
    await expect(
      actingAs(
        member,
        `insert into public.background_jobs
           (id, organization_id, kind, payload)
         values ('job-hijack', $1::uuid, 'promote_memories',
           jsonb_build_object('kind', 'promote_memories', 'organizationId', ($1::uuid)::text))`,
        [foreign]
      )
    ).rejects.toThrow(/row-level security/);
  });
});
