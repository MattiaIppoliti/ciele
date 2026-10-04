import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createSchemaLoadedPglite } from "./supabase-contract-harness";
let pg: PGlite;
const org = randomUUID(), foreignOrg = randomUUID(), user = randomUUID(), colleague = randomUUID();
async function actingAs(actor: string, sql: string, parameters: unknown[] = []) {
  await pg.query("select set_config('request.jwt.claim.sub', $1, false)", [actor]);
  await pg.exec("set role authenticated");
  try { return await pg.query(sql, parameters); }
  finally { await pg.exec("reset role"); }
}
beforeAll(async () => {
  pg = await createSchemaLoadedPglite();
  await pg.query("insert into auth.users (id,email) values ($1,'triage@test.dev'),($2,'colleague@test.dev')", [user,colleague]);
  await pg.query("insert into public.organizations(id,name) values ($1,'Triage'),($2,'Foreign')",[org,foreignOrg]);
  await pg.query("insert into public.organization_members(organization_id,user_id,role) values ($1,$2,'editor'),($1,$3,'editor')",[org,user,colleague]);
  await pg.exec("grant usage on schema public, private to authenticated; grant select, insert, update, delete on all tables in schema public to authenticated");
  await pg.query("insert into public.teammate_channels(id,organization_id,name,created_by) values ('triage-group',$1,'Triage',$2)",[org,user]);
  await pg.query("insert into public.teammate_channel_participants(id,organization_id,channel_id,user_id) values ('triage-seat',$1,'triage-group',$2)",[org,user]);
  await pg.query("insert into public.teammates(id,organization_id,name,owner_id) values ('triage-ai',$1,'AI',$2)",[org,user]);
  await pg.query("insert into public.conversations(id,teammate_id,subject_type,subject_id) values ('triage-thread','triage-ai','member',$1)",[user]);
},120_000);
afterAll(async()=>pg?.close());
describe("thread preference RLS",()=>{
  it("persists only the caller's preferences and keeps group membership authoritative",async()=>{
    await actingAs(user,"insert into public.thread_preferences(id,organization_id,user_id,channel_id,action) values ('own-archive',$1,$2,'triage-group','archive')",[org,user]);
    expect((await actingAs(user,"select id from public.thread_preferences")).rows).toEqual([{id:"own-archive"}]);
    expect((await actingAs(colleague,"select id from public.thread_preferences")).rows).toEqual([]);
    await expect(actingAs(colleague,"insert into public.thread_preferences(id,organization_id,user_id,channel_id,action) values ('outsider',$1,$2,'triage-group','flag')",[org,colleague])).rejects.toThrow(/policy|permission/i);
    await expect(actingAs(colleague,"insert into public.thread_preferences(id,organization_id,user_id,channel_id,action) values ('impersonate',$1,$2,'triage-group','flag')",[org,user])).rejects.toThrow(/policy|permission/i);
    await expect(actingAs(user,"insert into public.thread_preferences(id,organization_id,user_id,channel_id,action) values ('foreign',$1,$2,'triage-group','flag')",[foreignOrg,user])).rejects.toThrow(/policy|permission/i);
    await actingAs(colleague,"delete from public.thread_preferences where id='own-archive'");
    expect((await actingAs(user,"select id from public.thread_preferences")).rows).toEqual([{id:"own-archive"}]);
  });
  it("refuses a colleague's private history and immutable-row retargeting",async()=>{
    await actingAs(user,"insert into public.thread_preferences(id,organization_id,user_id,conversation_id,action) values ('own-flag',$1,$2,'triage-thread','flag')",[org,user]);
    await expect(actingAs(colleague,"insert into public.thread_preferences(id,organization_id,user_id,conversation_id,action) values ('colleague-flag',$1,$2,'triage-thread','flag')",[org,colleague])).rejects.toThrow(/policy|permission/i);
    const result=await actingAs(user,"update public.thread_preferences set user_id=$1 where id='own-flag' returning id",[colleague]);
    expect(result.rows).toEqual([]);
    expect((await actingAs(user,"select id from public.thread_preferences where id='own-flag'")).rows).toEqual([{id:"own-flag"}]);
    await expect(actingAs(user,"insert into public.thread_preferences(id,organization_id,user_id,conversation_id,channel_id,action) values ('two-targets',$1,$2,'triage-thread','triage-group','flag')",[org,user])).rejects.toThrow(/check constraint/);
  });
});
