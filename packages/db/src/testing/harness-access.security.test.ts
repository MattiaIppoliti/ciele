import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createSchemaLoadedPglite } from "./supabase-contract-harness";

let pg: PGlite;
let participant: string;
let outsider: string;
let admin: string;
let foreignAdmin: string;

async function user(org: string, role: string) {
  const id = randomUUID();
  await pg.query("insert into auth.users(id,email) values ($1,$2)", [id, `${id}@harness.test`]);
  await pg.query("insert into public.organization_members(organization_id,user_id,role) values ($1,$2,$3)", [org, id, role]);
  return id;
}

beforeAll(async () => {
  pg = await createSchemaLoadedPglite();
  const org = randomUUID();
  const foreign = randomUUID();
  await pg.query("insert into public.organizations(id,name) values ($1,'Harness'),($2,'Foreign')", [org, foreign]);
  participant = await user(org, "editor");
  outsider = await user(org, "editor");
  admin = await user(org, "admin");
  foreignAdmin = await user(foreign, "admin");
  await pg.query("insert into public.assistants(id,organization_id,title) values ('harness-assistant',$1,'Harness')", [org]);
  await pg.query("insert into public.conversations(id,assistant_id,subject_type,subject_id) values ('harness-conversation','harness-assistant','visitor','visitor')");
  await pg.query("select public.close_flow_gate_admission('harness-assistant',null)");
  await pg.query("select public.close_flow_gate_admission(null,'harness-conversation')");
  await pg.query("insert into public.assistants(id,organization_id,title) values ('open-assistant',$1,'Still open')", [org]);
  await pg.query("insert into public.conversations(id,assistant_id,subject_type,subject_id) values ('open-conversation','open-assistant','visitor','visitor')");
  await pg.query("insert into public.teammate_channels(id,organization_id,name,created_by) values ('harness-channel',$1,'Private channel',$2)", [org, participant]);
  await pg.query("insert into public.teammate_channel_participants(id,organization_id,channel_id,user_id) values ('harness-seat',$1,'harness-channel',$2)", [org, participant]);
  await pg.query("insert into public.action_approvals(id,organization_id,channel_id,requested_by,operation,label,reason,map_version,expires_at) values ('harness-approval',$1,'harness-channel',$2,'improvements.create','Create improvement','unsure',1,now()+interval '1 day')", [org, participant]);
  await pg.exec("grant usage on schema public, private to authenticated; grant select on public.action_approvals, public.teammate_channels, public.teammate_channel_participants to authenticated");
  await pg.exec("grant select, update on public.assistants, public.conversations to authenticated");
  await pg.exec("grant select on public.teammates to authenticated");
}, 120000);
afterAll(async () => { await pg?.close(); });

describe("harness authorization", () => {
  for (const [table, id] of [["assistants", "open-assistant"], ["conversations", "open-conversation"]] as const) {
    it(`cannot close ${table} gate admission through a direct member update`, async () => {
      await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [participant]);
      await pg.exec("set role authenticated");
      try {
        await expect(pg.query(`update public.${table} set gate_admission_closed = true where id = $1`, [id])).rejects.toThrow("Only the runtime");
        expect((await pg.query<{ gate_admission_closed: boolean }>(`select gate_admission_closed from public.${table} where id = $1`, [id])).rows).toEqual([{ gate_admission_closed: false }]);
      } finally { await pg.exec("reset role"); }
    });
  }
  for (const [table, id] of [["assistants", "harness-assistant"], ["conversations", "harness-conversation"]] as const) {
    it(`cannot reopen ${table} gate admission through an authorized member update`, async () => {
      await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [participant]);
      await pg.exec("set role authenticated");
      try {
        const result = await pg.query<{ gate_admission_closed: boolean }>(
          `update public.${table} set gate_admission_closed = false where id = $1 returning gate_admission_closed`, [id]
        );
        expect(result.rows).toEqual([{ gate_admission_closed: true }]);
      } finally { await pg.exec("reset role"); }
    });
  }
  for (const role of ["anon", "authenticated"]) {
    it(`keeps checkpoints and gate RPCs inaccessible to ${role}`, async () => {
      await pg.exec(`set role ${role}`);
      try {
        await expect(pg.query("select * from public.flow_continuations")).rejects.toThrow(/permission denied/);
        await expect(pg.query("select public.read_flow_continuation('unknown')")).rejects.toThrow(/permission denied/);
        await expect(pg.query("select public.close_flow_gate_admission('unknown',null)")).rejects.toThrow(/permission denied/);
        await expect(pg.query("select public.recover_flow_continuations(500)")).rejects.toThrow(/permission denied/);
        await expect(pg.query("select public.open_flow_gate('review','{}','{}')")).rejects.toThrow(/permission denied/);
      } finally { await pg.exec("reset role"); }
    });
  }
  for (const [name, getUser, count] of [
    ["participant", () => participant, 1], ["other org member", () => outsider, 0],
    ["admin oversight", () => admin, 1], ["foreign admin", () => foreignAdmin, 0],
  ] as const) {
    it(`scopes Channel approval reads for ${name}`, async () => {
      await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [getUser()]);
      await pg.exec("set role authenticated");
      try { expect((await pg.query("select id from public.action_approvals")).rows).toHaveLength(count); }
      finally { await pg.exec("reset role"); }
    });
  }
});
