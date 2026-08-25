import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createSchemaLoadedPglite } from "./supabase-contract-harness";

/**
 * The five-routines-per-Teammate cap (#772), against the shipping trigger.
 *
 * The operations layer counts and then inserts, which leaves a gap two
 * concurrent creates can both pass. This is the constraint behind it, so it has
 * to be tested where it lives: real migrations on PGlite.
 */

let pg: PGlite;
let orgId: string;

async function seedTeammate(name: string): Promise<string> {
  const id = `tm-${randomUUID()}`;
  await pg.query(
    `insert into public.teammates (id, organization_id, name) values ($1, $2, $3)`,
    [id, orgId, name]
  );
  return id;
}

const addRoutine = (teammateId: string, instruction: string) =>
  pg.query(
    `insert into public.teammate_routines (id, organization_id, teammate_id, instruction, cadence)
     values ($1, $2, $3, $4, 'daily')`,
    [`rt-${randomUUID()}`, orgId, teammateId, instruction]
  );

beforeAll(async () => {
  pg = await createSchemaLoadedPglite();
  orgId = randomUUID();
  await pg.query(`insert into public.organizations (id, name) values ($1, $2)`, [
    orgId,
    "Routine Cap U",
  ]);
}, 120_000);

afterAll(async () => {
  await pg?.close();
});

describe("teammate routine cap (#772)", () => {
  it("accepts five and refuses the sixth", async () => {
    const teammate = await seedTeammate("Nora");
    for (let i = 0; i < 5; i += 1) {
      await expect(addRoutine(teammate, `Job ${i}`)).resolves.toBeTruthy();
    }
    await expect(addRoutine(teammate, "One too many")).rejects.toThrow(
      /can have 5 routines/
    );
  });

  it("counts per Teammate, so a colleague's routines are not in the way", async () => {
    const mine = await seedTeammate("Mine");
    const theirs = await seedTeammate("Theirs");
    for (let i = 0; i < 5; i += 1) {
      await addRoutine(mine, `Mine ${i}`);
    }
    // `theirs` is empty: the cap is a per-Teammate rule, not a per-org one.
    await expect(addRoutine(theirs, "Theirs 0")).resolves.toBeTruthy();
  });

  it("frees a slot when one is deleted", async () => {
    const teammate = await seedTeammate("Recycler");
    for (let i = 0; i < 5; i += 1) {
      await addRoutine(teammate, `Job ${i}`);
    }
    await pg.query(
      `delete from public.teammate_routines
       where teammate_id = $1 and instruction = 'Job 0'`,
      [teammate]
    );
    await expect(addRoutine(teammate, "Replacement")).resolves.toBeTruthy();
  });
});
