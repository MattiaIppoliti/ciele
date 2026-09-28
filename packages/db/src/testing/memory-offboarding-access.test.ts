import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createSchemaLoadedPglite } from "./supabase-contract-harness";

/**
 * Personal memory follows the membership and the retention it came from
 * (20260927160000_memory_retention_and_offboarding.sql), asked as PostgREST
 * asks: an admin removing a Member cannot see that Member's User-layer
 * document (RLS is `member_id = auth.uid()`), so the cleanup has to happen in
 * the database or not at all.
 */

let pg: PGlite;
let orgId: string;
let admin: string;
let leaver: string;
let stayer: string;

async function seedUser(email: string, role: string): Promise<string> {
  const id = randomUUID();
  await pg.query(
    `insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, '{}')`,
    [id, email]
  );
  await pg.query(
    `insert into public.organization_members (organization_id, user_id, role) values ($1, $2, $3)`,
    [orgId, id, role]
  );
  return id;
}

async function actingAs(userId: string, sql: string, params: unknown[] = []) {
  await pg.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId]);
  await pg.exec("set role authenticated");
  try {
    return (await pg.query(sql, params)) as { rows: unknown[] };
  } finally {
    await pg.exec("reset role");
  }
}

async function memoryDocsOf(userId: string): Promise<number> {
  const { rows } = await pg.query<{ n: number }>(
    `select count(*)::int as n from public.memory_documents where organization_id = $1 and member_id = $2`,
    [orgId, userId]
  );
  return rows[0].n;
}

beforeAll(async () => {
  pg = await createSchemaLoadedPglite();
  orgId = randomUUID();
  await pg.query(`insert into public.organizations (id, name) values ($1, 'Offboarding Co')`, [orgId]);
  admin = await seedUser("admin@offboard.test", "owner");
  leaver = await seedUser("leaver@offboard.test", "editor");
  stayer = await seedUser("stayer@offboard.test", "editor");
  await pg.exec(`
    grant usage on schema public to authenticated;
    grant usage on schema private to authenticated;
    grant select, insert, update, delete on all tables in schema public to authenticated;
  `);
  for (const [id, member] of [["md-leaver", leaver], ["md-stayer", stayer]] as const) {
    await pg.query(
      `insert into public.memory_documents (id, organization_id, member_id, body) values ($1, $2, $3, 'prefers short answers')`,
      [id, orgId, member]
    );
    await pg.query(
      `insert into public.memory_document_entries (id, organization_id, document_id, body_before, note) values ($1, $2, $3, '', 'seed')`,
      [`${id}-e1`, orgId, id]
    );
  }
});

afterAll(async () => {
  await pg.close();
});

describe("removing a Member", () => {
  it("removes that Member's User-layer memory and its history, and nobody else's", async () => {
    // RLS hides the leaver's document from the admin doing the removal.
    const visible = await actingAs(
      admin,
      `select id from public.memory_documents where member_id = $1`,
      [leaver]
    );
    expect(visible.rows).toHaveLength(0);

    await actingAs(
      admin,
      `delete from public.organization_members where organization_id = $1 and user_id = $2`,
      [orgId, leaver]
    );
    expect(await memoryDocsOf(leaver)).toBe(0);
    const { rows } = await pg.query<{ n: number }>(
      `select count(*)::int as n from public.memory_document_entries where document_id = 'md-leaver'`
    );
    expect(rows[0].n).toBe(0);
    expect(await memoryDocsOf(stayer)).toBe(1);
  });
});

describe("Visitor memory retention", () => {
  it("deletes facts last updated before the cutoff, oldest first, and keeps recent ones", async () => {
    await pg.query(
      `insert into public.memories (id, organization_id, subject_id, text, created_at, updated_at)
       values ('mem-old', $1, 'v-1', 'lives in Rome', now() - interval '90 days', now() - interval '90 days'),
              ('mem-new', $1, 'v-1', 'works nights', now(), now())`,
      [orgId]
    );
    const { rows } = await pg.query<{ n: number }>(
      `select public.delete_expired_memories($1, now() - interval '30 days') as n`,
      [orgId]
    );
    expect(rows[0].n).toBe(1);
    const left = await pg.query<{ id: string }>(
      `select id from public.memories where organization_id = $1 order by id`,
      [orgId]
    );
    expect(left.rows.map((r) => r.id)).toEqual(["mem-new"]);
  });
});
