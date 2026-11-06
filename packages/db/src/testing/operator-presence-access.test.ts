import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createSupabaseDb } from "../supabase";
import { createPgliteSupabaseClient } from "./postgrest-shim";
import { createSchemaLoadedPglite } from "./supabase-contract-harness";

/**
 * Desk operators and their presence, asked as `authenticated`
 * (20261021120000_help_desk_operators.sql, #1084). Staffing a desk is an
 * Editor's act; a status is the Member's own, and only a Member who may
 * answer Visitors sets one.
 */

let pg: PGlite;
let orgId: string;
let editor: string;
let viewer: string;
let colleague: string;

async function seedUser(email: string, role: string): Promise<string> {
  const id = randomUUID();
  await pg.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, '{}')`, [id, email]);
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

beforeAll(async () => {
  pg = await createSchemaLoadedPglite();
  orgId = randomUUID();
  await pg.query(`insert into public.organizations (id, name) values ($1, 'Desk Org')`, [orgId]);
  editor = await seedUser("editor@desk-test.example", "editor");
  viewer = await seedUser("viewer@desk-test.example", "viewer");
  colleague = await seedUser("colleague@desk-test.example", "editor");
  await pg.exec(`
    grant usage on schema public to authenticated;
    grant usage on schema private to authenticated;
    grant select, insert, update, delete on all tables in schema public to authenticated;
  `);
  await pg.query(`insert into public.help_desks (id, organization_id, name) values ('desk-1', $1, 'Desk')`, [orgId]);
});

afterAll(async () => {
  await pg.close();
});

const presence = (member: string, status = "available") =>
  `insert into public.operator_presence (id, organization_id, member_id, status)
   values ('${randomUUID()}', '${orgId}', '${member}', '${status}') returning id`;

describe("operator presence", () => {
  it("lets an Editor set their own status", async () => {
    expect((await actingAs(editor, presence(editor))).rows).toHaveLength(1);
  });

  it("refuses setting a colleague's status", async () => {
    await expect(actingAs(editor, presence(colleague))).rejects.toThrow(/row-level security/);
  });

  it("refuses a Viewer, who does not answer Visitors", async () => {
    await expect(actingAs(viewer, presence(viewer))).rejects.toThrow(/row-level security/);
  });

  it("is readable by every Member of the Organization", async () => {
    const { rows } = await actingAs(viewer, `select member_id from public.operator_presence`);
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe("quick texts (#1085)", () => {
  const addQuickText = () =>
    `insert into public.quick_texts (id, organization_id, title, body)
     values ('${randomUUID()}', '${orgId}', 'Greeting', 'Hello') returning id`;

  it("lets an Editor write one and every Member read it", async () => {
    expect((await actingAs(editor, addQuickText())).rows).toHaveLength(1);
    const { rows } = await actingAs(viewer, `select id from public.quick_texts`);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("refuses a Viewer writing one", async () => {
    await expect(actingAs(viewer, addQuickText())).rejects.toThrow(/row-level security/);
  });
});

describe("desk operators", () => {
  const addOperator = (member: string) =>
    `insert into public.help_desk_operators (id, organization_id, help_desk_id, member_id)
     values ('${randomUUID()}', '${orgId}', 'desk-1', '${member}') returning id`;

  it("lets an Editor staff a desk", async () => {
    expect((await actingAs(editor, addOperator(colleague))).rows).toHaveLength(1);
  });

  it("refuses a Viewer", async () => {
    await expect(actingAs(viewer, addOperator(viewer))).rejects.toThrow(/row-level security/);
  });
});

it("renews only the caller's live Available lease and never revives Away", async () => {
  await pg.query("update public.operator_presence set status='available',updated_at=now() where member_id=$1", [editor]);
  expect((await actingAs(editor, "select public.renew_operator_presence($1,$2,now()) as renewed", [orgId, editor])).rows).toEqual([{ renewed: true }]);
  expect((await actingAs(colleague, "select public.renew_operator_presence($1,$2,now()) as renewed", [orgId, editor])).rows).toEqual([{ renewed: false }]);
  await pg.query("update public.operator_presence set status='away' where member_id=$1", [editor]);
  expect((await actingAs(editor, "select public.renew_operator_presence($1,$2,now()) as renewed", [orgId, editor])).rows).toEqual([{ renewed: false }]);
});

it("persists the assignment atomically and exposes its notification only to the recipient", async () => {
  const db = createSupabaseDb(createPgliteSupabaseClient(pg, { id: editor, email: "editor@desk-test.example" }));
  const assistant = await db.createAssistant(orgId, { title: "Assignment notice" });
  const conversation = await db.createConversation({ assistantId: assistant.id, subjectType: "visitor", subjectId: "assignment-notice" });
  await pg.query("update public.operator_presence set status='available',updated_at=now() where member_id=$1", [editor]);
  await pg.query("insert into public.help_desk_operators(id,organization_id,help_desk_id,member_id,capacity) values('notice-staff',$1,'desk-1',$2,3) on conflict(help_desk_id,member_id) do update set capacity=3", [orgId, editor]);
  const now = new Date().toISOString();
  await db.startConversationWait({ conversationId: conversation.id, helpDeskId: "desk-1", channelId: "live", timeoutMinutes: 30, now });
  await db.assignWaitingConversation({ conversationId: conversation.id, memberId: editor, now });
  const query = "select kind,conversation_id from public.member_notifications where conversation_id=$1";
  expect((await actingAs(editor, query, [conversation.id])).rows).toEqual([{ kind: "conversation_assigned", conversation_id: conversation.id }]);
  expect((await actingAs(colleague, query, [conversation.id])).rows).toEqual([]);
  await expect(actingAs(editor, "insert into public.member_notifications(id,organization_id,recipient_id,kind,conversation_id) values('forged',$1,$2,'conversation_assigned',$3)", [orgId, editor, conversation.id])).rejects.toThrow(/row-level security/i);
});

it("checks capacity atomically when separate waiting rows race for the last slot", async () => {
  const db = createSupabaseDb(createPgliteSupabaseClient(pg, { id: editor, email: "editor@desk-test.example" }));
  await pg.query("insert into public.operator_presence(id,organization_id,member_id,status) values('race-presence',$1,$2,'available') on conflict(organization_id,member_id) do update set status='available',updated_at=now()", [orgId, colleague]);
  await pg.query("insert into public.help_desk_operators(id,organization_id,help_desk_id,member_id,capacity) values('race-staff',$1,'desk-1',$2,1) on conflict(help_desk_id,member_id) do update set capacity=1", [orgId, colleague]);
  const assistant = await db.createAssistant(orgId, { title: "Capacity race" });
  const now = new Date().toISOString();
  const ids: string[] = [];
  for (const subjectId of ["sql-race-one", "sql-race-two"]) {
    const row = await db.createConversation({ assistantId: assistant.id, subjectType: "visitor", subjectId });
    await db.startConversationWait({ conversationId: row.id, helpDeskId: "desk-1", channelId: "live", timeoutMinutes: 30, now });
    ids.push(row.id);
  }
  const assigned = await Promise.all(ids.map(conversationId => db.assignWaitingConversation({ conversationId, memberId: colleague, now })));
  expect(assigned.filter(Boolean)).toHaveLength(1);
  expect(await db.table("memberNotifications").list({ conversationId: assigned.find(Boolean)!.id })).toHaveLength(1);
});
