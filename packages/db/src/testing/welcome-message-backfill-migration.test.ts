import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { DEFAULT_WELCOME_MESSAGE } from "@agent-hub/core";
import { createSchemaLoadedPglite } from "./supabase-contract-harness";

/**
 * The backfill that retires the education-specific default Welcome Message.
 * Runs the REAL migration against seeded legacy rows: the harness boots the
 * full schema (the migration no-ops on an empty database), the test then seeds
 * pre-upgrade `welcome_message` values and re-runs the file, which is
 * legitimate because the migration is idempotent by design and is exactly what
 * a self-hoster's upgrade does.
 *
 * Asserting against `DEFAULT_WELCOME_MESSAGE` is deliberate: editing that
 * constant again without writing a new backfill fails here.
 */

const MIGRATION = fileURLToPath(
  new URL(
    "../../../../supabase/migrations/20260819140000_neutral_welcome_message_backfill.sql",
    import.meta.url
  )
);

const LEGACY =
  "I can help you with academic information: study plans, academic deadlines, class materials. Tell me: what information would you like to know?";

const SEEDED_AT = "2026-01-01T00:00:00.000Z";

let pg: PGlite;
let orgId: string;

const runMigration = () => pg.exec(readFileSync(MIGRATION, "utf8"));

const welcomeOf = async (id: string): Promise<string> => {
  const { rows } = await pg.query<{ welcome_message: string }>(
    `select welcome_message from public.assistants where id = $1`,
    [id]
  );
  return rows[0].welcome_message;
};

async function seedAssistant(id: string, welcome: string): Promise<void> {
  await pg.query(
    `insert into public.assistants
       (id, title, organization_id, welcome_message, updated_at)
     values ($1, $2, $3, $4, $5)`,
    [id, `Assistant ${id}`, orgId, welcome, SEEDED_AT]
  );
}

beforeAll(async () => {
  pg = await createSchemaLoadedPglite();
  orgId = randomUUID();
  await pg.query(`insert into public.organizations (id, name) values ($1, $2)`, [
    orgId,
    "Legacy Welcome U",
  ]);

  await seedAssistant("as-legacy", LEGACY);
  // Trailing whitespace is still the untouched default, so btrim catches it.
  await seedAssistant("as-padded", `  ${LEGACY}\n`);
  // A Member wrote this one. Education-specific on purpose, and off limits.
  await seedAssistant(
    "as-custom",
    "Welcome to the Physics department. Ask me about lab hours."
  );
  // The column default: nothing was ever stamped here.
  await seedAssistant("as-empty", "");

  await runMigration();
}, 120_000);

afterAll(async () => {
  await pg?.close();
});

describe("neutral welcome-message backfill", () => {
  it("replaces the academic default with the neutral copy", async () => {
    expect(await welcomeOf("as-legacy")).toBe(DEFAULT_WELCOME_MESSAGE);
  });

  it("catches a whitespace-padded copy of the same default", async () => {
    expect(await welcomeOf("as-padded")).toBe(DEFAULT_WELCOME_MESSAGE);
  });

  it("leaves a Member-authored Welcome Message alone", async () => {
    expect(await welcomeOf("as-custom")).toBe(
      "Welcome to the Physics department. Ask me about lab hours."
    );
  });

  it("leaves an empty Welcome Message empty", async () => {
    expect(await welcomeOf("as-empty")).toBe("");
  });

  it("says nothing academic anywhere afterwards", async () => {
    const { rows } = await pg.query<{ count: number }>(
      `select count(*)::int as count from public.assistants
       where welcome_message ilike '%academic%'`
    );
    expect(rows[0].count).toBe(0);
  });

  it("does not bump updated_at, since this is not a Member edit", async () => {
    // Scoped to this test's org: the migration chain seeds its own demo
    // Assistants, whose updated_at is whenever the harness booted.
    const { rows } = await pg.query<{ count: number }>(
      `select count(*)::int as count from public.assistants
       where organization_id = $1 and updated_at <> $2`,
      [orgId, SEEDED_AT]
    );
    expect(rows[0].count).toBe(0);
  });

  it("is idempotent", async () => {
    await runMigration();
    expect(await welcomeOf("as-legacy")).toBe(DEFAULT_WELCOME_MESSAGE);
    expect(await welcomeOf("as-custom")).toBe(
      "Welcome to the Physics department. Ask me about lab hours."
    );
  });
});
