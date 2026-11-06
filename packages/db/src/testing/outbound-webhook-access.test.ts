import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
  await pg.query("insert into public.organizations(id, name) values ($1, 'Webhook access')", [organizationId]);
  for (const [id, role] of [[adminId, "admin"], [editorId, "editor"]]) {
    await pg.query("insert into auth.users(id, email, raw_user_meta_data) values ($1, $2, '{}')", [id, `${id}@example.com`]);
    await pg.query("insert into public.organization_members(organization_id, user_id, role) values ($1, $2, $3)", [organizationId, id, role]);
  }
  await pg.query("insert into auth.users(id, email, raw_user_meta_data) values ($1, 'foreign-webhook@example.com', '{}')", [foreignId]);
  await pg.exec("grant usage on schema public, private to authenticated");
}, 180_000);
afterAll(async () => { await pg?.close(); });

describe("outbound webhook access in Postgres", () => {
  it("lets an Admin create a subscription without exposing its sealed secret", async () => {
    const result = await asMember(adminId,
      "select public.create_outbound_webhook_subscription('wh-access', $1, 'Receiver', 'https://example.com/events', array['conversation.escalated'], 'sealed-secret') as subscription",
      [organizationId]);
    expect(result.rows).toMatchObject([{ subscription: { id: "wh-access", organization_id: organizationId } }]);
    expect(JSON.stringify(result.rows)).not.toContain("sealed-secret");
    await expect(asMember(adminId, "select * from public.outbound_webhook_secrets")).rejects.toThrow(/permission denied/i);
    await expect(asMember(adminId, "update public.outbound_webhook_subscriptions set organization_id = $1 where id = 'wh-access'", [randomUUID()])).rejects.toThrow(/permission denied/i);
  });

  it("refuses Editor and foreign-member access through both tables and the creation function", async () => {
    for (const userId of [editorId, foreignId]) {
      expect((await asMember(userId, "select * from public.outbound_webhook_subscriptions")).rows).toEqual([]);
      expect((await asMember(userId, "select * from public.webhook_deliveries")).rows).toEqual([]);
      await expect(asMember(userId,
        "select public.create_outbound_webhook_subscription($1, $2, 'Denied', 'https://example.com/events', array['alert.raised'], 'sealed-secret')",
        [randomUUID(), organizationId])).rejects.toThrow(/forbidden/i);
    }
  });
});
