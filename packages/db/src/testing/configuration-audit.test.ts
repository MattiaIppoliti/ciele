import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createSchemaLoadedPglite } from "./supabase-contract-harness";
import { createPgliteSupabaseClient } from "./postgrest-shim";
import { createSupabaseDb } from "../supabase";
import type { Db } from "../types";
let pg: PGlite;
let db: Db;
let organizationId: string;
const userId = randomUUID();
beforeAll(async () => {
  pg = await createSchemaLoadedPglite();
  await pg.query("insert into auth.users(id,email,raw_user_meta_data) values($1,'audit-owner@example.com','{}')", [userId]);
  await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [userId]);
  db = createSupabaseDb(createPgliteSupabaseClient(pg, { id: userId, email: "audit-owner@example.com" }));
  organizationId = await db.createOrganization("Audit security");
}, 180_000);
afterAll(async () => { await pg?.close(); });
it("records through the append RPC, stamps the authenticated actor and refuses updates and deletes", async () => {
  await pg.exec("grant usage on schema public,private,auth to authenticated; set role authenticated");
  try {
    await db.recordAuditEntry({ organizationId, operation: "assistants.update", effect: "write", entities: [{ kind: "assistant", id: "deleted-assistant" }], memberId: null, memberName: "forged", memberEmail: "forged@example.com", apiKeyId: null, teammateId: null, agentAuthor: null, surface: "console", outcome: "ok" });
    const [entry] = await db.listAuditEntries(organizationId, {});
    expect(entry).toMatchObject({ memberId: userId, memberEmail: "audit-owner@example.com", operation: "assistants.update" });
    await expect(pg.query("update public.audit_log set outcome='rewritten' where id=$1", [entry.id])).rejects.toThrow(/permission denied/i);
    await expect(pg.query("delete from public.audit_log where id=$1", [entry.id])).rejects.toThrow(/permission denied/i);
  } finally { await pg.exec("reset role"); }
});

it("restricts reads to Owner/Admin and removes entries with Organization offboarding and retention", async () => {
  const editor=randomUUID();
  await pg.query("insert into auth.users(id,email,raw_user_meta_data) values($1,'audit-editor@example.com','{}')",[editor]);
  await pg.query("insert into public.organization_members(organization_id,user_id,role) values($1,$2,'editor')",[organizationId,editor]);
  await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[editor]);
  await pg.exec("set role authenticated");
  try {
    expect(await db.listAuditEntries(organizationId,{})).toEqual([]);
    const result = await db.leaveOrganization(organizationId, editor, { organizationId, operation: "members.leave", effect: "consequential", entities: [{ kind: "members" }], memberId: editor, memberName: "Editor", memberEmail: "audit-editor@example.com", apiKeyId: null, teammateId: null, agentAuthor: null, surface: "console", outcome: "ok" });
    expect(result.auditRecorded).toBe(true);
  }
  finally { await pg.exec("reset role"); await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[userId]); }
  expect((await db.listAuditEntries(organizationId, { memberId: editor }))[0]).toMatchObject({ operation: "members.leave", outcome: "ok", memberId: editor });
  expect(await db.getMemberRole(organizationId, editor)).toBeNull();
  await pg.query("update public.audit_log set created_at=now()-interval '181 days' where organization_id=$1",[organizationId]);
  await db.sweepRuntimeLedgers(new Date().toISOString(),1000);
  expect(await db.listAuditEntries(organizationId,{})).toEqual([]);
  await db.recordAuditEntry({ organizationId,operation:"organization.update",effect:"write",entities:[],memberId:userId,memberName:null,memberEmail:null,apiKeyId:null,teammateId:null,agentAuthor:null,surface:"console",outcome:"ok" });
  await pg.query("delete from public.organizations where id=$1",[organizationId]);
  expect(await db.listAuditEntries(organizationId,{})).toEqual([]);
});

it("keeps the described target and changes, drops an oversized description, and sweeps by the organization's own window", async () => {
  await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [userId]);
  const org = await db.createOrganization("Audit window");
  await pg.exec("set role authenticated");
  try {
    await db.recordAuditEntry({ organizationId: org, operation: "members.updateRole", effect: "consequential", entities: [{ kind: "members" }], memberId: null, memberName: null, memberEmail: null, apiKeyId: null, teammateId: null, agentAuthor: null, surface: "console", outcome: "ok", targetLabel: "viewer@example.com", targetDetail: "Editor role", changes: { Role: { before: "Viewer", after: "Editor" } } });
    await db.recordAuditEntry({ organizationId: org, operation: "organization.update", effect: "consequential", entities: [], memberId: null, memberName: null, memberEmail: null, apiKeyId: null, teammateId: null, agentAuthor: null, surface: "console", outcome: "ok", changes: { Name: { before: "x".repeat(20_000), after: "y" } } });
    const rows = await db.listAuditEntries(org, { order: "oldest" });
    expect(rows[0]).toMatchObject({ targetLabel: "viewer@example.com", targetDetail: "Editor role", changes: { Role: { before: "Viewer", after: "Editor" } } });
    // Over 16 KB the description goes; the entry itself still lands.
    expect(rows[1]).toMatchObject({ operation: "organization.update", changes: {} });
  } finally { await pg.exec("reset role"); }
  await pg.query("update public.organizations set audit_retention_days=30 where id=$1", [org]);
  await pg.query("update public.audit_log set created_at=now()-interval '31 days' where organization_id=$1", [org]);
  await db.sweepRuntimeLedgers(new Date().toISOString(), 1000);
  expect(await db.listAuditEntries(org, {})).toEqual([]);
});
