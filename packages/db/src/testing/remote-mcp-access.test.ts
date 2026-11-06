import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createSchemaLoadedPglite } from "./supabase-contract-harness";
let pg: PGlite;
const organizationId = randomUUID();
const adminId = randomUUID();
const editorId = randomUUID();
const foreignId = randomUUID();
async function asMember(userId: string, sql: string, parameters: unknown[] = []) {
  await pg.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await pg.exec("set role authenticated");
  try { return await pg.query(sql, parameters); }
  finally { await pg.exec("reset role"); }
}
beforeAll(async () => {
  pg = await createSchemaLoadedPglite();
  await pg.query("insert into public.organizations(id, name) values ($1, 'MCP access')", [organizationId]);
  for (const [id, role] of [[adminId, "admin"], [editorId, "editor"]]) {
    await pg.query("insert into auth.users(id, email, raw_user_meta_data) values ($1, $2, '{}')", [id, `${id}@example.com`]);
    await pg.query("insert into public.organization_members(organization_id, user_id, role) values ($1, $2, $3)", [organizationId, id, role]);
  }
  await pg.query("insert into auth.users(id, email, raw_user_meta_data) values ($1, 'foreign-mcp@example.com', '{}')", [foreignId]);
  await pg.exec("grant usage on schema public, private to authenticated");
}, 180_000);
afterAll(async () => { await pg?.close(); });
it("keeps sealed tokens service-only while Members can read tool definitions", async () => {
  const created = await asMember(adminId, "select public.create_mcp_server_connection('mcp-access', $1, 'Tools', 'https://example.com/mcp', '[]', 'sealed-mcp-access-token') as connection", [organizationId]);
  expect(JSON.stringify(created.rows)).not.toContain("sealed-mcp-access-token");
  expect((await asMember(editorId, "select name from public.mcp_server_connections where id = 'mcp-access'")).rows).toEqual([{ name: "Tools" }]);
  for (const userId of [adminId, editorId, foreignId]) await expect(asMember(userId, "select * from public.mcp_server_secrets")).rejects.toThrow(/permission denied/i);
  expect((await asMember(foreignId, "select * from public.mcp_server_connections")).rows).toEqual([]);
  await asMember(editorId, "update public.mcp_server_connections set tools = '[]', revision = 99 where id = 'mcp-access'");
  expect((await asMember(adminId, "select revision from public.mcp_server_connections where id = 'mcp-access'")).rows).toEqual([{ revision: 1 }]);
  await expect(asMember(adminId, "update public.mcp_server_connections set organization_id = $1 where id = 'mcp-access'", [randomUUID()])).rejects.toThrow(/permission denied/i);
  await expect(asMember(editorId, "select public.create_mcp_server_connection('refused-mcp', $1, 'No', 'https://example.com/mcp', '[]', null)", [organizationId])).rejects.toThrow(/forbidden/i);
});
