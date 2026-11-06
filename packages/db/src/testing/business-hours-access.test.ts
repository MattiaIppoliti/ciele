import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { defaultChannelAvailability } from "@agent-hub/core";
import { createSchemaLoadedPglite } from "./supabase-contract-harness";
let pg: PGlite;
const org = randomUUID();
const editor = randomUUID();
const viewer = randomUUID();
const foreign = randomUUID();
async function asMember(userId: string, sql: string, parameters: unknown[] = []) {
  await pg.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await pg.exec("set role authenticated");
  try { return await pg.query(sql, parameters); } finally { await pg.exec("reset role"); }
}
beforeAll(async () => {
  pg = await createSchemaLoadedPglite();
  await pg.query("insert into public.organizations(id,name) values ($1,'Business hours access')", [org]);
  for (const [id, role] of [[editor, "editor"], [viewer, "viewer"], [foreign, null]]) {
    await pg.query("insert into auth.users(id,email,raw_user_meta_data) values ($1,$2,'{}')", [id, `${id}@hours.example`]);
    if (role) await pg.query("insert into public.organization_members(organization_id,user_id,role) values ($1,$2,$3)", [org, id, role]);
  }
  await pg.exec("grant usage on schema public,private to authenticated");
}, 180_000);
afterAll(async () => { await pg?.close(); });
it("lets Editors manage only this setting and keeps defaults behind atomic RPCs", async () => {
  const create = "select public.save_business_hours($1,'hours-access','Office','UTC',$2,'[]',true,true)";
  const args = [org, JSON.stringify(defaultChannelAvailability().hours)];
  for (const id of [viewer, foreign]) await expect(asMember(id, create, args)).rejects.toThrow(/Forbidden/i);
  await asMember(editor, create, args);
  await asMember(editor, "select public.set_default_timezone($1,'Europe/Rome')", [org]);
  expect((await pg.query("select default_timezone from public.organizations where id=$1", [org])).rows).toEqual([{ default_timezone: "Europe/Rome" }]);
  await expect(asMember(viewer, "select public.set_default_timezone($1,'UTC')", [org])).rejects.toThrow(/Forbidden/i);
  await expect(asMember(editor, "update public.business_hours set is_default=false where id='hours-access'")).rejects.toThrow(/permission denied/i);
  expect((await asMember(foreign, "select * from public.business_hours")).rows).toEqual([]);
  expect((await asMember(viewer, "select name from public.business_hours")).rows).toEqual([{ name: "Office" }]);
  await asMember(editor, "select public.delete_business_hours($1,'hours-access')", [org]);
});
