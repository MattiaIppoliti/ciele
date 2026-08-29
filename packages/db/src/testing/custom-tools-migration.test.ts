import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createSchemaLoadedPglite } from "./supabase-contract-harness";

/**
 * The expand-contract *migrate* step for the per-endpoint custom HTTP tools
 * (#575). Runs the REAL migration against seeded legacy rows: the harness
 * boots the full schema (the migration no-ops on an empty database), the test
 * then seeds pre-upgrade `assistants.tools.custom` configurations and re-runs
 * the file, legitimate because the migration is idempotent by design, and
 * exactly what a self-hoster's upgrade does to their existing rows.
 */

const MIGRATION = fileURLToPath(
  new URL(
    "../../../../supabase/migrations/20260730190000_migrate_custom_tools.sql",
    import.meta.url
  )
);

let pg: PGlite;
let orgId: string;

async function seedAssistant(id: string, tools: unknown): Promise<void> {
  await pg.query(
    `insert into public.assistants (id, title, organization_id, tools)
     values ($1, $2, $3, $4)`,
    [id, `Assistant ${id}`, orgId, JSON.stringify(tools)]
  );
}

const runMigration = () => pg.exec(readFileSync(MIGRATION, "utf8"));

beforeAll(async () => {
  pg = await createSchemaLoadedPglite();
  orgId = randomUUID();
  await pg.query(`insert into public.organizations (id, name) values ($1, $2)`, [
    orgId,
    "Legacy Tools U",
  ]);

  // Convertible: two tools, one origin, no headers, no query strings.
  await seedAssistant("as-convert", {
    builtIns: { fetchUrl: false },
    custom: [
      {
        id: "ct-1",
        name: "lookup_account",
        description: "Fetch one student account",
        url: "https://api.campus.example/accounts/lookup",
        method: "GET",
        params: [{ name: "studentId", description: "Student number", required: true }],
      },
      {
        id: "ct-2",
        name: "open_ticket",
        description: "Open a support ticket",
        url: "https://api.campus.example/tickets",
        method: "POST",
      },
    ],
  });

  // Non-convertible: a plaintext auth header the integration cannot carry.
  await seedAssistant("as-headers", {
    custom: [
      {
        id: "ct-3",
        name: "secure_lookup",
        description: "Authenticated lookup",
        url: "https://api.campus.example/secure",
        method: "GET",
        headers: [{ name: "authorization", value: "Bearer plaintext-secret" }],
      },
    ],
  });

  // Non-convertible: an API Integration already registered must not be clobbered.
  await seedAssistant("as-existing", {
    custom: [
      {
        id: "ct-4",
        name: "old_tool",
        description: "Old tool",
        url: "https://legacy.example/x",
        method: "GET",
      },
    ],
  });
  await pg.query(
    `insert into public.assistant_api_integrations
       (assistant_id, organization_id, name, base_url, auth_type, endpoints)
     values ($1, $2, 'Real integration', 'https://api.real.example', 'none', '[]')`,
    ["as-existing", orgId]
  );

  await runMigration();
}, 120_000);

afterAll(async () => {
  await pg?.close();
});

describe("custom-tools migration (#575)", () => {
  it("converts a clean config into one integration with a one-endpoint-per-tool catalogue", async () => {
    const { rows } = await pg.query<{
      base_url: string;
      auth_type: string;
      endpoints: unknown;
    }>(
      `select base_url, auth_type, endpoints
       from public.assistant_api_integrations where assistant_id = 'as-convert'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].base_url).toBe("https://api.campus.example");
    expect(rows[0].auth_type).toBe("none");
    const endpoints = rows[0].endpoints as Array<Record<string, unknown>>;
    expect(endpoints).toHaveLength(2);
    expect(endpoints[0]).toMatchObject({
      id: "ct-1",
      name: "lookup_account",
      path: "/accounts/lookup",
      method: "GET",
      purpose: "Fetch one student account",
      params: [
        { name: "studentId", description: "Student number", required: true, in: "query" },
      ],
    });
    expect(endpoints[1]).toMatchObject({
      id: "ct-2",
      path: "/tickets",
      method: "POST",
    });
  });

  it("preserves an unconvertible config in an Alert instead of dropping it silently", async () => {
    const { rows } = await pg.query<{ detail: string; status: string; type: string }>(
      `select detail, status, type from public.alerts
       where source_key = 'custom-tools-migration:as-headers'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("active");
    expect(rows[0].type).toBe("integration");
    // The original configuration travels verbatim, so nothing is lost.
    expect(rows[0].detail).toContain("secure_lookup");
    expect(rows[0].detail).toContain("https://api.campus.example/secure");
  });

  it("never clobbers an integration the assistant already has", async () => {
    const { rows } = await pg.query<{ name: string }>(
      `select name from public.assistant_api_integrations
       where assistant_id = 'as-existing'`
    );
    expect(rows).toEqual([{ name: "Real integration" }]);
    const { rows: alerts } = await pg.query(
      `select 1 from public.alerts
       where source_key = 'custom-tools-migration:as-existing'`
    );
    expect(alerts).toHaveLength(1);
  });

  it("removes the dead custom key from every assistant", async () => {
    const { rows } = await pg.query<{ n: number }>(
      `select count(*)::int as n from public.assistants
       where tools ? 'custom'`
    );
    expect(rows[0].n).toBe(0);
    // …while keeping the rest of the tools config intact.
    const { rows: tools } = await pg.query<{ tools: unknown }>(
      `select tools from public.assistants where id = 'as-convert'`
    );
    expect(tools[0].tools).toEqual({ builtIns: { fetchUrl: false } });
  });

  it("re-running is a no-op: no duplicate integrations, no duplicate alerts", async () => {
    await runMigration();
    const { rows: integrations } = await pg.query<{ n: number }>(
      `select count(*)::int as n from public.assistant_api_integrations
       where assistant_id = 'as-convert'`
    );
    expect(integrations[0].n).toBe(1);
    const { rows: alerts } = await pg.query<{ n: number }>(
      `select count(*)::int as n from public.alerts
       where source_key like 'custom-tools-migration:%'`
    );
    expect(alerts[0].n).toBe(2);
  });
});
