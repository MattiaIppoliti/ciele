import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createSchemaLoadedPglite } from "./supabase-contract-harness";

/**
 * Inbox writes to a Visitor Conversation, asked the way PostgREST asks them
 * (20260927120000_conversation_member_writes.sql).
 *
 * Before that migration the UPDATE and DELETE policies matched only a Member's
 * own Preview thread, so every one of these writes matched zero rows and the
 * console reported success. A zero-row result is how RLS says no, which is why
 * each case here counts the rows it changed instead of waiting for an error.
 */

let pg: PGlite;
let orgId: string;
let otherOrgId: string;
let admin: string;
let viewer: string;
let outsider: string;

async function seedUser(org: string, email: string, role: string): Promise<string> {
  const id = randomUUID();
  await pg.query(
    `insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, '{}')`,
    [id, email]
  );
  await pg.query(
    `insert into public.organization_members (organization_id, user_id, role)
     values ($1, $2, $3)`,
    [org, id, role]
  );
  return id;
}

async function actingAs(userId: string, sql: string, params: unknown[] = []) {
  await pg.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId]);
  await pg.exec("set role authenticated");
  try {
    return (await pg.query(sql, params)) as { rows: unknown[]; affectedRows?: number };
  } finally {
    await pg.exec("reset role");
  }
}

async function asService(sql: string, params: unknown[] = []) {
  await pg.query(`select set_config('request.jwt.claim.sub', '', false)`);
  return pg.query(sql, params);
}

async function legalHold(id: string): Promise<boolean | null> {
  const { rows } = await asService(
    `select legal_hold from public.conversations where id = $1`,
    [id]
  );
  return (rows[0] as { legal_hold: boolean } | undefined)?.legal_hold ?? null;
}

beforeAll(async () => {
  pg = await createSchemaLoadedPglite();
  orgId = randomUUID();
  otherOrgId = randomUUID();
  await pg.query(
    `insert into public.organizations (id, name) values ($1, 'Hold U'), ($2, 'Elsewhere')`,
    [orgId, otherOrgId]
  );
  admin = await seedUser(orgId, "admin@hold-test.edu", "admin");
  viewer = await seedUser(orgId, "viewer@hold-test.edu", "viewer");
  outsider = await seedUser(otherOrgId, "outsider@hold-test.edu", "admin");
  await pg.exec(`
    grant usage on schema public to authenticated;
    grant usage on schema private to authenticated;
    grant select, insert, update, delete on all tables in schema public to authenticated;
  `);
  await pg.query(
    `insert into public.assistants (id, organization_id, title) values ('hold-assistant', $1, 'Help')`,
    [orgId]
  );
});

beforeEach(async () => {
  await asService(`update public.conversations set legal_hold = false`);
  await asService(`delete from public.conversations`);
  await asService(
    `insert into public.conversations (id, assistant_id, subject_type, subject_id)
     values ('visitor-thread', 'hold-assistant', 'visitor', 'v-1')`
  );
});

afterAll(async () => {
  await pg.close();
});

describe("Inbox writes to a Visitor Conversation", () => {
  it("lets a Member of the Organization pin it", async () => {
    const result = await actingAs(
      viewer,
      `update public.conversations set pinned = true where id = 'visitor-thread' returning id`
    );
    expect(result.rows).toHaveLength(1);
  });

  it("refuses a Member of another Organization", async () => {
    const result = await actingAs(
      outsider,
      `update public.conversations set pinned = true where id = 'visitor-thread' returning id`
    );
    expect(result.rows).toHaveLength(0);
  });

  it("records a legal hold an admin places", async () => {
    const result = await actingAs(
      admin,
      `update public.conversations set legal_hold = true where id = 'visitor-thread' returning id`
    );
    expect(result.rows).toHaveLength(1);
    expect(await legalHold("visitor-thread")).toBe(true);
  });

  it("refuses a legal hold change from a non-admin", async () => {
    await expect(
      actingAs(
        viewer,
        `update public.conversations set legal_hold = true where id = 'visitor-thread'`
      )
    ).rejects.toThrow(/admin/);
    expect(await legalHold("visitor-thread")).toBe(false);
  });

  it("lets a Member delete an unheld one", async () => {
    const result = await actingAs(
      viewer,
      `delete from public.conversations where id = 'visitor-thread' returning id`
    );
    expect(result.rows).toHaveLength(1);
  });
});

describe("a Conversation under legal hold", () => {
  beforeEach(async () => {
    await asService(`update public.conversations set legal_hold = true where id = 'visitor-thread'`);
  });

  it("cannot be deleted by a Member", async () => {
    await expect(
      actingAs(viewer, `delete from public.conversations where id = 'visitor-thread'`)
    ).rejects.toThrow(/legal hold/);
  });

  it("cannot be deleted by the service role", async () => {
    await expect(
      asService(`delete from public.conversations where id = 'visitor-thread'`)
    ).rejects.toThrow(/legal hold/);
  });

  it("stops its Assistant being deleted out from under it", async () => {
    await expect(
      asService(`delete from public.assistants where id = 'hold-assistant'`)
    ).rejects.toThrow(/legal hold/);
    expect(await legalHold("visitor-thread")).toBe(true);
  });

  it("is still skipped by the retention sweep", async () => {
    const { rows } = await asService(
      `select public.delete_expired_conversations($1, now() + interval '1 day') as deleted`,
      [orgId]
    );
    expect((rows[0] as { deleted: number }).deleted).toBe(0);
    expect(await legalHold("visitor-thread")).toBe(true);
  });
});
