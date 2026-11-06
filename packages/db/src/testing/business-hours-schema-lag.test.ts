import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { Db } from "../types";
import { createSupabaseDb } from "../supabase";
import { createPgliteSupabaseClient } from "./postgrest-shim";
import { createSchemaLoadedPglite } from "./supabase-contract-harness";
let pg: PGlite;
let db: Db;
let organizationId: string;
const userId = randomUUID();
beforeAll(async () => {
  pg = await createSchemaLoadedPglite({ stopBefore: "20261022180000_business_hours.sql" });
  await pg.query("insert into auth.users(id,email,raw_user_meta_data) values ($1,'hours-lag@example.com','{}')", [userId]);
  await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [userId]);
  db = createSupabaseDb(createPgliteSupabaseClient(pg, { id: userId, email: "hours-lag@example.com" }));
  organizationId = await db.createOrganization("Hours schema lag");
}, 180_000);
afterAll(async () => { await pg?.close(); });
it("keeps Organization reads and legacy channel availability usable one migration behind", async () => {
  expect((await db.listOrganizations()).find(row => row.id === organizationId)).toMatchObject({ name: "Hours schema lag", defaultTimezone: "UTC" });
  await db.updateOrganization(organizationId, { name: "Hours lag updated", transcriptRetentionDays: 90 });
  expect((await db.listOrganizations()).find(row => row.id === organizationId)).toMatchObject({ name: "Hours lag updated", transcriptRetentionDays: 90 });
  const desk = await db.createHelpDesk(organizationId, { name: "Legacy desk" });
  const channel = await db.createSupportChannel(desk.id, { name: "Email", kind: "email" });
  expect(channel.availability.mode).toBe("always");
});
