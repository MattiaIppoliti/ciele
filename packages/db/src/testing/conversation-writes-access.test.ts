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
let editor: string;
let viewer: string;
let supportAgent: string;
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
  editor = await seedUser(orgId, "editor@hold-test.edu", "editor");
  viewer = await seedUser(orgId, "viewer@hold-test.edu", "viewer");
  supportAgent = await seedUser(orgId, "agent@hold-test.edu", "support_agent");
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

/**
 * Who answers a Conversation (20261021100000_conversation_operators.sql,
 * #1082). The operator columns are guarded by a trigger and the operator
 * message insert by a policy; both ask `private.may_answer_conversation`,
 * which is what a Viewer fails and an Editor passes.
 */
describe("taking a Conversation over", () => {
  const takeOver = (userId: string) =>
    `update public.conversations
       set operator_state = 'held', operator_member_id = '${userId}', operator_name = 'Dana'
     where id = 'visitor-thread' and operator_member_id is null
     returning id`;

  it("lets an Editor take it over", async () => {
    const result = await actingAs(editor, takeOver(editor));
    expect(result.rows).toHaveLength(1);
  });

  it("refuses a Viewer, who may read the Inbox but not answer in it", async () => {
    await expect(actingAs(viewer, takeOver(viewer))).rejects.toThrow(/answer Visitors/);
  });

  it("lets the service role start a wait for the widget", async () => {
    const { rows } = await asService(
      `update public.conversations set operator_state = 'waiting', waiting_since = now()
       where id = 'visitor-thread' returning id`
    );
    expect(rows).toHaveLength(1);
  });

  it("refuses holding it in a colleague's name", async () => {
    await expect(actingAs(editor, takeOver(admin))).rejects.toThrow(/only as themselves/);
  });

  it("refuses a Viewer rewriting the name the Widget shows", async () => {
    await asService(
      `update public.conversations set operator_state = 'held', operator_member_id = '${editor}', operator_name = 'Dana'
       where id = 'visitor-thread'`
    );
    await expect(
      actingAs(viewer, `update public.conversations set operator_name = 'Mallory' where id = 'visitor-thread'`)
    ).rejects.toThrow(/answer Visitors/);
    await expect(
      actingAs(viewer, `update public.conversations set wait_timeout_minutes = 60 where id = 'visitor-thread'`)
    ).rejects.toThrow(/answer Visitors/);
  });

  const insertOperatorMessage = (authorId: string, name = "Dana") =>
    `insert into public.messages (id, conversation_id, role, content, author_member_id, author_name)
     values ('${randomUUID()}', 'visitor-thread', 'operator', '[{"type":"text","text":"Hi"}]', '${authorId}', '${name}')
     returning id`;

  it("lets the holder write an operator reply under their stored name", async () => {
    await actingAs(editor, takeOver(editor));
    const result = await actingAs(editor, insertOperatorMessage(editor));
    expect(result.rows).toHaveLength(1);
  });

  it("refuses a reply under another name, or from a Member who does not hold it", async () => {
    await actingAs(editor, takeOver(editor));
    await expect(actingAs(editor, insertOperatorMessage(editor, "The CEO"))).rejects.toThrow(/row-level security/);
    await expect(actingAs(admin, insertOperatorMessage(admin))).rejects.toThrow(/row-level security/);
  });

  it("refuses an operator reply written in somebody else's name", async () => {
    await expect(actingAs(editor, insertOperatorMessage(admin))).rejects.toThrow(/row-level security/);
  });

  it("refuses an operator reply from a Viewer", async () => {
    await expect(actingAs(viewer, insertOperatorMessage(viewer))).rejects.toThrow(/row-level security/);
  });

  it("refuses a Member of another Organization", async () => {
    await expect(actingAs(outsider, insertOperatorMessage(outsider))).rejects.toThrow(/row-level security/);
  });
});

/**
 * The Support Agent Role (20261021160000_support_agent_role.sql, #1086): it
 * ranks as a Viewer in every ladder comparison and answers Visitors through
 * the named check only.
 */
describe("a Support Agent", () => {
  it("may take a Conversation over and reply as themselves", async () => {
    const taken = await actingAs(
      supportAgent,
      `update public.conversations set operator_state = 'held', operator_member_id = '${supportAgent}', operator_name = 'Agent'
       where id = 'visitor-thread' returning id`
    );
    expect(taken.rows).toHaveLength(1);
    const reply = await actingAs(
      supportAgent,
      `insert into public.messages (id, conversation_id, role, content, author_member_id, author_name)
       values ('${randomUUID()}', 'visitor-thread', 'operator', '[]', '${supportAgent}', 'Agent') returning id`
    );
    expect(reply.rows).toHaveLength(1);
  });

  it("ranks as a Viewer everywhere the ladder is asked", async () => {
    const { rows } = await actingAs(
      supportAgent,
      `select private.has_org_role($1, 2) as editor, private.has_org_role($1, 1) as member`,
      [orgId]
    );
    expect(rows[0]).toEqual({ editor: false, member: true });
  });

  it("cannot change an Assistant", async () => {
    const result = await actingAs(
      supportAgent,
      `update public.assistants set title = 'Renamed' where id = 'hold-assistant' returning id`
    );
    expect(result.rows).toHaveLength(0);
  });
});
