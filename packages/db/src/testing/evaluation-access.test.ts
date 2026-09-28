import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createSchemaLoadedPglite } from "./supabase-contract-harness";

/**
 * Who may record an Eval run, against the shipping migration.
 *
 * The console checks that the Assistant and the dataset belong to the caller's
 * Organization, and PostgREST is a way around the console. So the policy's own
 * cross-org check is asserted here, as `authenticated` with the caller's id in
 * the JWT claim, the way a Member's own token reaches the table. The first
 * version of the policy compared an unqualified `organization_id` inside its
 * subqueries, which bound to the subquery's table and passed for any org the
 * caller could read, so an Editor in one Organization and a Viewer in another
 * could record a run in the first over the second's Assistant.
 */

let pg: PGlite;
let orgA: string;
let orgB: string;
let editorA: string;

async function seedOrg(name: string): Promise<string> {
  const id = randomUUID();
  await pg.query(`insert into public.organizations (id, name) values ($1, $2)`, [
    id,
    name,
  ]);
  return id;
}

async function actingAs(
  userId: string,
  sql: string,
  params: unknown[] = []
): Promise<{ rows: unknown[] }> {
  await pg.query(`select set_config('request.jwt.claim.sub', $1, false)`, [
    userId,
  ]);
  await pg.exec("set role authenticated");
  try {
    return (await pg.query(sql, params)) as { rows: unknown[] };
  } finally {
    await pg.exec("reset role");
  }
}

function insertRun(id: string, assistantId: string, datasetId: string) {
  return actingAs(
    editorA,
    `insert into public.evaluation_runs
       (id, organization_id, assistant_id, assistant_name, assistant_model,
        dataset_id, dataset_name, examples, stage, candidates)
     values ($1, $2, $3, 'Assistant', '{}'::jsonb, $4, 'Dataset', '[]'::jsonb,
             'answer', '[]'::jsonb)
     returning id`,
    [id, orgA, assistantId, datasetId]
  );
}

beforeAll(async () => {
  pg = await createSchemaLoadedPglite();
  orgA = await seedOrg("Eval Org A");
  orgB = await seedOrg("Eval Org B");
  editorA = randomUUID();
  await pg.query(
    `insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, '{}')`,
    [editorA, "editor@eval-test.example"]
  );
  await pg.query(
    `insert into public.organization_members (organization_id, user_id, role)
     values ($1, $2, 'editor')
     on conflict (organization_id, user_id) do update set role = excluded.role`,
    [orgA, editorA]
  );
  // Also a Viewer in org B, so B's rows are visible through B's own read
  // policies. Without that seat the subqueries find nothing whatever they
  // compare, and the policy's own org check would go untested.
  await pg.query(
    `insert into public.organization_members (organization_id, user_id, role)
     values ($1, $2, 'viewer')`,
    [orgB, editorA]
  );

  // Supabase grants these to `authenticated` out of band; see channel-access.
  await pg.exec(`
    grant usage on schema public to authenticated;
    grant usage on schema private to authenticated;
    grant select, insert, update, delete
      on all tables in schema public to authenticated;
  `);

  await pg.query(
    `insert into public.assistants (id, organization_id, title)
     values ('as-a', $1, 'Mine'), ('as-b', $2, 'Theirs')`,
    [orgA, orgB]
  );
  await pg.query(
    `insert into public.evaluation_datasets (id, organization_id, name, examples)
     values ('ds-a', $1, 'Mine', '[]'::jsonb), ('ds-b', $2, 'Theirs', '[]'::jsonb)`,
    [orgA, orgB]
  );
}, 120_000);

afterAll(async () => {
  await pg?.close();
});

describe("evaluation runs, as PostgREST reaches them", () => {
  it("records a run over the editor's own Assistant and dataset", async () => {
    const run = await insertRun("run-own", "as-a", "ds-a");
    expect(run.rows).toHaveLength(1);
  });

  it("refuses a run over another Organization's Assistant", async () => {
    await expect(insertRun("run-foreign-assistant", "as-b", "ds-a")).rejects.toThrow(
      /row-level security/
    );
  });

  it("refuses a run over another Organization's dataset", async () => {
    await expect(insertRun("run-foreign-dataset", "as-a", "ds-b")).rejects.toThrow(
      /row-level security/
    );
  });

  it("refuses repointing an own run at another Organization's Assistant", async () => {
    const moved = await actingAs(
      editorA,
      `update public.evaluation_runs set assistant_id = 'as-b'
        where id = 'run-own' returning id`
    ).catch((error: Error) => error);
    if (!(moved instanceof Error)) expect(moved.rows).toHaveLength(0);
    const row = await pg.query(
      `select assistant_id from public.evaluation_runs where id = 'run-own'`
    );
    expect((row.rows[0] as { assistant_id: string }).assistant_id).toBe("as-a");
  });
});
