import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createSchemaLoadedPglite } from "./supabase-contract-harness";

/**
 * `escalation_tickets` asked the way PostgREST asks it
 * (20261022100000_help_desk_ticketing_target.sql).
 *
 * Members read their own Organization's rows; nobody signed in writes them.
 * The claim and the settle run through the system Db in the widget's
 * escalation transaction, and a Member PATCH marking a submission filed would
 * be the way around the idempotency the table exists for. RLS answers a write
 * it refuses with zero rows, so each case counts rows rather than waiting for
 * an error.
 */

let pg: PGlite;
let orgId: string;
let otherOrgId: string;
let admin: string;
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
    return (await pg.query(sql, params)) as { rows: unknown[] };
  } finally {
    await pg.exec("reset role");
  }
}

beforeAll(async () => {
  pg = await createSchemaLoadedPglite();
  orgId = randomUUID();
  otherOrgId = randomUUID();
  await pg.query(
    `insert into public.organizations (id, name) values ($1, 'Tickets U'), ($2, 'Elsewhere')`,
    [orgId, otherOrgId]
  );
  admin = await seedUser(orgId, "admin@tickets-test.edu", "admin");
  outsider = await seedUser(otherOrgId, "outsider@tickets-test.edu", "admin");
  await pg.exec(`
    grant usage on schema public to authenticated;
    grant usage on schema private to authenticated;
    grant select, insert, update, delete on all tables in schema public to authenticated;
  `);
  await pg.query(
    `insert into public.help_desks (id, organization_id, name) values ('desk-1', $1, 'IT')`,
    [orgId]
  );
  await pg.query(
    `insert into public.support_channels (id, help_desk_id, kind, name)
     values ('chan-1', 'desk-1', 'ticket', 'Open a ticket')`
  );
  await pg.query(
    `insert into public.escalation_tickets
       (id, organization_id, idempotency_key, help_desk_id, channel_id, provider, status)
     values ('tkt-1', $1, 'escalation/a/op', 'desk-1', 'chan-1', 'salesforce', 'pending')`,
    [orgId]
  );
});

afterAll(async () => {
  await pg.close();
});

describe("escalation_tickets", () => {
  it("lets a Member of the Organization read its rows", async () => {
    const result = await actingAs(admin, `select id from public.escalation_tickets`);
    expect(result.rows).toEqual([{ id: "tkt-1" }]);
  });

  it("hides them from a Member of another Organization", async () => {
    const result = await actingAs(outsider, `select id from public.escalation_tickets`);
    expect(result.rows).toHaveLength(0);
  });

  it("refuses a Member's update, even an admin's", async () => {
    const result = await actingAs(
      admin,
      `update public.escalation_tickets set status = 'filed' where id = 'tkt-1' returning id`
    );
    expect(result.rows).toHaveLength(0);
  });

  it("refuses a Member's insert", async () => {
    await expect(
      actingAs(
        admin,
        `insert into public.escalation_tickets
           (id, organization_id, idempotency_key, help_desk_id, channel_id, provider)
         values ('tkt-2', $1, 'escalation/a/op-2', 'desk-1', 'chan-1', 'salesforce')`,
        [orgId]
      )
    ).rejects.toThrow(/row-level security/);
  });
});
