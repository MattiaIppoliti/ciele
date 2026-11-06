import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createSupabaseDb } from "../supabase";
import { createPgliteSupabaseClient } from "./postgrest-shim";
import { createSchemaLoadedPglite } from "./supabase-contract-harness";

/**
 * The expand step retiring the password-grant ServiceNow registration
 * (#1089): every desk still holding one gets an Alert. The harness boots the
 * whole chain on an empty database, where the statement inserts nothing, so
 * the test seeds desks and re-runs the migration's Alert statement, which is
 * idempotent by its `on conflict do nothing`.
 */

const MIGRATION = fileURLToPath(
  new URL(
    "../../../../supabase/migrations/20261022100000_help_desk_ticketing_target.sql",
    import.meta.url
  )
);

const alertStatement = (): string => {
  const sql = readFileSync(MIGRATION, "utf8");
  return sql.slice(sql.indexOf("insert into public.alerts"));
};

let pg: PGlite;
let orgId: string;

beforeAll(async () => {
  pg = await createSchemaLoadedPglite();
  orgId = randomUUID();
  await pg.query(`insert into public.organizations (id, name) values ($1, 'Legacy U')`, [orgId]);
  await pg.query(
    `insert into public.help_desks (id, organization_id, name, ticketing_integration)
     values ('desk-legacy', $1, 'IT', $2), ('desk-none', $1, 'HR', null)`,
    [orgId, JSON.stringify({ platform: "servicenow", config: { password: "sealed" } })]
  );
});

afterAll(async () => {
  await pg.close();
});

describe("legacy ServiceNow ticketing Alert", () => {
  it("raises one integration Alert per desk still holding the registration, once", async () => {
    await pg.exec(alertStatement());
    await pg.exec(alertStatement());
    const { rows } = await pg.query<{ type: string; title: string; source_key: string; status: string }>(
      `select type, title, source_key, status from public.alerts where organization_id = $1`,
      [orgId]
    );
    expect(rows).toEqual([
      {
        type: "integration",
        title: "Reconnect ServiceNow ticketing for IT",
        source_key: "ticketing-legacy:desk-legacy",
        status: "active",
      },
    ]);
  });
  it("reads desks and removes retired credentials when the ticketing target migration is not applied", async () => {
    await pg.exec("alter table public.help_desks drop column ticketing_target");
    const db = createSupabaseDb(createPgliteSupabaseClient(pg, { id: randomUUID(), email: "system@example.com" }, "service_role"));
    expect((await db.getHelpDesk("desk-legacy"))?.ticketingTarget).toBeUndefined();
    const cleared = await db.clearTicketingIntegration("desk-legacy");
    expect(cleared.ticketingIntegration).toBeNull();
    expect(cleared.ticketingTarget).toBeUndefined();
  });

});
