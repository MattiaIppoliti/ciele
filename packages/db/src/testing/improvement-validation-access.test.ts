import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createSchemaLoadedPglite } from "./supabase-contract-harness";

/**
 * `improvement_validations` asked as `authenticated` (supabase/CLAUDE.md: the
 * harness is a superuser, so a policy no test switches role for is
 * unasserted). The table is append-only evidence, readable by the
 * Organization's Members who may see the Assistant, writable by its Editors.
 */

let pg: PGlite;
const org = randomUUID();
const editor = randomUUID();
const viewer = randomUUID();
const outsider = randomUUID();
/** An org Editor whose access to this one Assistant is `denied`. */
const deniedEditor = randomUUID();

beforeAll(async () => {
  pg = await createSchemaLoadedPglite();
  await pg.query("insert into public.organizations(id,name) values ($1,'Validation access')", [org]);
  const people: Array<[string, string | null]> = [
    [editor, "editor"],
    [viewer, "viewer"],
    [outsider, null],
    [deniedEditor, "editor"],
  ];
  for (const [id, role] of people) {
    await pg.query("insert into auth.users(id,email) values ($1,$2)", [id, `${id}@validation.test`]);
    if (role) {
      await pg.query(
        "insert into public.organization_members(organization_id,user_id,role) values ($1,$2,$3)",
        [org, id, role],
      );
    }
  }
  await pg.query(
    "insert into public.assistants(id,organization_id,title) values ('validation-assistant',$1,'Validation')",
    [org],
  );
  await pg.query(
    "insert into public.assistant_access(assistant_id,user_id,role) values ('validation-assistant',$1,'denied')",
    [deniedEditor],
  );
  await pg.query(
    "insert into public.improvements(id,organization_id,seq,title) values ('validation-item',$1,1,'Gap')",
    [org],
  );
  // What Supabase grants out of band; RLS is what this test asserts.
  await pg.exec(
    "grant usage on schema public, private to authenticated; grant select,insert,update,delete on all tables in schema public to authenticated",
  );
});

afterAll(async () => {
  await pg?.close();
});

async function actingAs(id: string, sql: string, params: unknown[] = []) {
  await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await pg.exec("set role authenticated");
  try {
    return await pg.query(sql, params);
  } finally {
    await pg.exec("reset role");
  }
}

function insert(id: string, kind = "manual", status = "pass") {
  return `insert into public.improvement_validations(id,organization_id,improvement_id,assistant_id,validator_id,kind,status,expected_behavior,changed_resources,detail,snapshot) values ('${id}',$1,'validation-item','validation-assistant',$2,'${kind}','${status}','Correct answer','FAQ','Checked widget','snapshot')`;
}

describe("Improvement validation RLS", () => {
  it("lets an Editor record only their own evidence, then keeps it append-only", async () => {
    await actingAs(editor, insert("manual-check"), [org, editor]);
    const updated = await actingAs(
      editor,
      "update public.improvement_validations set detail='forged' where id='manual-check' returning id",
    );
    expect(updated.rows).toHaveLength(0);
    const deleted = await actingAs(
      editor,
      "delete from public.improvement_validations where id='manual-check' returning id",
    );
    expect(deleted.rows).toHaveLength(0);
    await expect(actingAs(editor, insert("forged-author"), [org, viewer])).rejects.toThrow();
  });

  it("refuses a manual record that claims to be pending, or a replay that claims a result", async () => {
    await expect(actingAs(editor, insert("manual-pending", "manual", "pending"), [org, editor])).rejects.toThrow();
    await expect(actingAs(editor, insert("replay-pass", "replay", "pass"), [org, editor])).rejects.toThrow();
  });

  it("refuses Viewer writes and hides records from non-members", async () => {
    await expect(actingAs(viewer, insert("viewer-check"), [org, viewer])).rejects.toThrow();
    expect((await actingAs(viewer, "select id from public.improvement_validations")).rows.length).toBeGreaterThan(0);
    expect((await actingAs(outsider, "select * from public.improvement_validations")).rows).toHaveLength(0);
  });

  it("follows per-Assistant access: a denied Editor neither writes nor reads", async () => {
    await expect(actingAs(deniedEditor, insert("denied-check"), [org, deniedEditor])).rejects.toThrow();
    expect((await actingAs(deniedEditor, "select id from public.improvement_validations")).rows).toHaveLength(0);
  });

  it("atomically queues a replay and refuses duplicate pending work", async () => {
    await actingAs(editor, insert("replay-check", "replay", "pending"), [org, editor]);
    const jobs = await pg.query<{ organization_id: string; kind: string; max_attempts: number }>(
      "select organization_id, kind, max_attempts from public.background_jobs where payload->>'validationId'='replay-check'",
    );
    expect(jobs.rows).toEqual([{ organization_id: org, kind: "replay_improvement", max_attempts: 1 }]);
    await expect(actingAs(editor, insert("duplicate-check", "replay", "pending"), [org, editor])).rejects.toThrow();
    expect(
      (await pg.query("select id from public.background_jobs where payload->>'validationId'='duplicate-check'")).rows,
    ).toHaveLength(0);
  });
});
