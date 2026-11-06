import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { exportScheduleSlot } from "@agent-hub/core";
import { createSchemaLoadedPglite } from "./supabase-contract-harness";
import { createPgliteSupabaseClient } from "./postgrest-shim";
import { createSupabaseDb } from "../supabase";
import type { Db } from "../types";
let pg: PGlite; let db: Db; let organizationId: string;
const owner = randomUUID(); const viewer = randomUUID(); const outsider = randomUUID();
beforeAll(async () => {
  pg = await createSchemaLoadedPglite();
  for (const id of [owner, viewer, outsider]) await pg.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,'{}')", [id, `${id}@example.test`]);
  await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
  db = createSupabaseDb(createPgliteSupabaseClient(pg, { id: owner, email: `${owner}@example.test` }));
  organizationId = await db.createOrganization("Scheduled export access");
  await pg.query("insert into public.organization_members(organization_id,user_id,role) values($1,$2,'viewer')", [organizationId, viewer]);
  await pg.exec("grant usage on schema public,private,auth to authenticated; grant select on public.organization_members to authenticated");
}, 180_000);
afterAll(async () => { await pg?.close(); });
const input = () => ({ organizationId, name: "Weekly", kind: "insights_overview" as const, format: "csv" as const, filters: {}, cadence: { kind: "weekly" as const, weekday: 1 }, hour: 8, recipientMemberIds: [viewer] });
it("requires write permission and current Member recipients, and makes queue claims system-only", async () => {
  await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [viewer]); await pg.exec("set role authenticated");
  try {
    await expect(db.table("exportSchedules").insert(input())).rejects.toThrow(/row-level security/i);
    await expect(db.queueDueExportSchedules("2030-02-04T10:00:00Z", 10)).rejects.toThrow(/permission denied/i);
  } finally { await pg.exec("reset role"); await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]); }
  await expect(db.table("exportSchedules").insert({ ...input(), recipientMemberIds: [outsider] })).rejects.toThrow(/Organization Members/i);
});
it("drops a departing recipient and pauses a schedule when none remain", async () => {
  const row = await db.table("exportSchedules").insert(input());
  await db.removeMember(organizationId, viewer);
  expect(await db.table("exportSchedules").get(row.id)).toMatchObject({ recipientMemberIds: [], enabled: false });
});
it("keeps the SQL slot oracle equal to UTC domain scheduling across month ends and DST dates", async () => {
  const dates = ["2024-02-29T09:00:00Z", "2026-02-28T07:00:00Z", "2026-03-29T01:30:00Z", "2026-10-25T01:30:00Z", "2026-12-31T23:00:00Z"];
  for (const value of dates) for (const cadence of [{ kind: "monthly" as const, day: 31 }, { kind: "monthly" as const, day: 1 }, ...[0, 1, 6].map(weekday => ({ kind: "weekly" as const, weekday }))]) {
    const result = await pg.query<{ slot: Date }>("select private.export_schedule_slot($1::jsonb,8,$2::timestamptz) as slot", [JSON.stringify(cadence), value]);
    expect(new Date(result.rows[0].slot).toISOString()).toBe(exportScheduleSlot({ cadence, hour: 8 }, new Date(value)).toISOString());
  }
});
