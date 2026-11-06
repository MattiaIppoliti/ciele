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
let messageId: string;
const userId = randomUUID();
beforeAll(async () => {
  pg = await createSchemaLoadedPglite();
  await pg.query("insert into auth.users(id,email,raw_user_meta_data) values($1,'moderation@example.test','{}')", [userId]);
  await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [userId]);
  db = createSupabaseDb(createPgliteSupabaseClient(pg, { id: userId, email: "moderation@example.test" }));
  organizationId = await db.createOrganization("Moderation access");
  const assistant = await db.createAssistant(organizationId, { title: "Moderation" });
  const conversation = await db.createConversation({ assistantId: assistant.id, subjectType: "visitor", subjectId: "visitor" });
  messageId = (await db.appendMessage({ conversationId: conversation.id, role: "assistant", content: [{ type: "text", text: "Answer" }] })).id;
}, 180_000);
afterAll(async () => { await pg?.close(); });
it("refuses an authenticated Member who tries to forge a system moderation result", async () => {
  await pg.exec("grant usage on schema public,private,auth to authenticated; grant select on all tables in schema public to authenticated; set role authenticated");
  try {
    await expect(db.recordMessageModeration(organizationId, messageId, { id: "forged", type: "moderation", name: "Forged", target: "answer", outcome: "logged", flagged: true })).rejects.toThrow(/permission denied/i);
  } finally { await pg.exec("reset role"); }
  expect((await db.getMessage(messageId))?.trace).toBeNull();
});
it("reports unavailable quality features while the schema is one migration behind", async () => {
  await pg.exec("drop function public.get_moderation_counts(uuid,timestamptz,timestamptz,text); drop function public.get_flagged_inbox_page(uuid,jsonb)");
  expect(await db.getModerationCounts(organizationId, "2000-01-01T00:00:00Z", "2099-01-01T00:00:00Z")).toBeNull();
  expect(await db.getInboxPage(organizationId, { flaggedAnswer: true })).toMatchObject({ conversations: [], qualityAvailable: false });
  expect((await db.getInboxPage(organizationId, {})).conversations).toHaveLength(1);
});
