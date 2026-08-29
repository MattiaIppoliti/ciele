import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createSchemaLoadedPglite } from "./supabase-contract-harness";

/**
 * The consumer-domain signup block's exception list is deployment config,
 * empty by default (#434): a fresh deployment blocks every consumer domain
 * until an operator inserts a row into private.signup_email_exceptions.
 * Runs the REAL migrations on PGlite so the shipping trigger is exercised.
 */

let pg: PGlite;

const signUp = (email: string) =>
  pg.query(
    "insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, '{}')",
    [randomUUID(), email]
  );

beforeAll(async () => {
  pg = await createSchemaLoadedPglite();
}, 120_000);

afterAll(async () => {
  await pg?.close();
});

describe("consumer-domain signup exceptions (#434)", () => {
  it("blocks consumer domains when no exceptions are configured", async () => {
    await expect(signUp("someone@gmail.com")).rejects.toThrow(
      /company or institution email/
    );
  });

  it("still accepts non-consumer domains", async () => {
    await expect(signUp("dean@some-university.edu")).resolves.toBeTruthy();
  });

  it("an operator-configured exception signs up despite a blocked domain", async () => {
    await pg.query(
      "insert into private.signup_email_exceptions (email) values ($1)",
      ["founder@gmail.com"]
    );
    await expect(signUp("Founder@Gmail.com")).resolves.toBeTruthy();
    // Other addresses on the domain stay blocked.
    await expect(signUp("intruder@gmail.com")).rejects.toThrow(
      /company or institution email/
    );
  });
});
