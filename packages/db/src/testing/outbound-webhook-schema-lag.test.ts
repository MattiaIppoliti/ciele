import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildPublicationConfig } from "@agent-hub/core";
import type { Db } from "../types";
import { createSupabaseDb } from "../supabase";
import { createPgliteSupabaseClient } from "./postgrest-shim";
import { createSchemaLoadedPglite } from "./supabase-contract-harness";

let pg: PGlite;
let db: Db;
let organizationId: string;
const userId = randomUUID();
beforeAll(async () => {
  pg = await createSchemaLoadedPglite({ stopBefore: "20261022110000_outbound_webhooks.sql" });
  await pg.query("insert into auth.users(id, email, raw_user_meta_data) values ($1, 'owner@webhook-lag.example', '{}')", [userId]);
  await pg.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  db = createSupabaseDb(createPgliteSupabaseClient(pg, { id: userId, email: "owner@webhook-lag.example" }));
  organizationId = await db.createOrganization("Webhook schema lag");
}, 180_000);
afterAll(async () => { await pg?.close(); });

describe("one migration before outbound webhooks", () => {
  it("keeps Improvement creation, publication and the default job drain usable", async () => {
    const assistant = await db.createAssistant(organizationId, { title: "Before webhooks" });
    const improvement = await db.createImprovement(organizationId, { title: "Review instructions", source: "flow_action", assistantId: assistant.id });
    expect(improvement.title).toBe("Review instructions");
    expect((await db.getImprovement(improvement.id))?.id).toBe(improvement.id);
    const publication = await db.createPublication(assistant.id, buildPublicationConfig(assistant, [], [], []), userId);
    expect(publication.version).toBe(1);
    expect(await db.claimBackgroundJobs({ kind: "deliver_outbound_webhook", workerId: "lag-test", now: new Date().toISOString(), staleBefore: "2000-01-01T00:00:00Z", limit: 10 })).toEqual([]);
  });
});
