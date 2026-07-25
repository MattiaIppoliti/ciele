import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createSchemaLoadedPglite } from "./supabase-contract-harness";

/**
 * Superuser enrollment is allowlist-driven and empty by default (#431). A
 * fresh deployment must grant zero platform superusers: the signup trigger
 * only enrolls emails an operator explicitly inserted into
 * private.platform_superuser_emails. Runs the REAL migrations on PGlite so
 * the shipping trigger is what's exercised.
 */

const MIGRATIONS_DIR = fileURLToPath(
  new URL("../../../../supabase/migrations", import.meta.url)
);

let pg: PGlite;

const signUp = async (email: string): Promise<string> => {
  const id = randomUUID();
  await pg.query(
    "insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, '{}')",
    [id, email]
  );
  return id;
};

const superuserCount = async (): Promise<number> => {
  const res = await pg.query<{ n: number }>(
    "select count(*)::int as n from private.platform_superusers"
  );
  return res.rows[0].n;
};

beforeAll(async () => {
  pg = await createSchemaLoadedPglite();
}, 120_000);

afterAll(async () => {
  await pg?.close();
});

describe("platform superuser allowlist (#431)", () => {
  it("a fresh deployment with an empty allowlist grants zero superusers", async () => {
    await signUp("dean@fresh-deploy.edu");
    await signUp("admin@fresh-deploy.edu");
    expect(await superuserCount()).toBe(0);
  });

  it("an operator-allowlisted email is enrolled at signup; others still are not", async () => {
    await pg.query(
      "insert into private.platform_superuser_emails (email) values ($1)",
      ["operator@fresh-deploy.edu"]
    );
    const operatorId = await signUp("Operator@Fresh-Deploy.edu"); // case-insensitive
    await signUp("bystander@fresh-deploy.edu");

    const enrolled = await pg.query<{ user_id: string }>(
      "select user_id from private.platform_superusers"
    );
    expect(enrolled.rows.map((r) => r.user_id)).toEqual([operatorId]);
  });

  it("no personal email literal remains in the superuser-granting migrations", () => {
    const superuserMigrations = readdirSync(MIGRATIONS_DIR).filter((f) =>
      /superuser|user_org_profile/.test(f)
    );
    expect(superuserMigrations.length).toBeGreaterThanOrEqual(3);
    for (const file of superuserMigrations) {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
      // The personal token itself must not appear here either (this file is
      // mirrored); the mirror gate's deny-list carries the exact markers.
      expect(sql, `${file} must not hardcode a personal email`).not.toMatch(
        /@(gmail|outlook|hotmail|yahoo)\./i
      );
    }
  });
});
