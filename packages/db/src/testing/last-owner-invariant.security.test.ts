import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createSchemaLoadedPglite } from "./supabase-contract-harness";

/**
 * The Owner invariant (#801, CYB-11), against the shipping constraint trigger.
 *
 * The operations layer counts owners and then writes, which leaves a gap two
 * concurrent demotions both pass, and an Organization with no Owner can never
 * appoint one. This is the constraint behind that check, so it has to be
 * tested where it lives: real migrations on PGlite.
 */

let pg: PGlite;
let orgId: string;

async function seedMember(role: "owner" | "admin"): Promise<string> {
  const userId = randomUUID();
  await pg.query(`insert into auth.users (id) values ($1)`, [userId]);
  await pg.query(
    `insert into public.organization_members (organization_id, user_id, role)
     values ($1, $2, $3)`,
    [orgId, userId, role]
  );
  return userId;
}

const owners = async () =>
  Number(
    (
      await pg.query<{ count: number | string }>(
        `select count(*) as count from public.organization_members
         where organization_id = $1 and role = 'owner'`,
        [orgId]
      )
    ).rows[0]!.count
  );

beforeAll(async () => {
  pg = await createSchemaLoadedPglite();
  orgId = randomUUID();
  await pg.query(`insert into public.organizations (id, name) values ($1, $2)`, [
    orgId,
    "Owner Invariant U",
  ]);
}, 120_000);

afterAll(async () => {
  await pg?.close();
});

describe("an Organization may never be left without an Owner", () => {
  it("refuses to delete the last owner's membership", async () => {
    const owner = await seedMember("owner");
    await seedMember("admin");

    await expect(
      pg.query(
        `delete from public.organization_members
         where organization_id = $1 and user_id = $2`,
        [orgId, owner]
      )
    ).rejects.toThrow(/no owner/i);
    expect(await owners()).toBe(1);
  });

  it("refuses to demote the last owner", async () => {
    await expect(
      pg.query(
        `update public.organization_members set role = 'admin'
         where organization_id = $1 and role = 'owner'`,
        [orgId]
      )
    ).rejects.toThrow(/no owner/i);
    expect(await owners()).toBe(1);
  });

  it("allows a handover that passes through a state with no owner", async () => {
    // Deferred to commit on purpose: a handover written as two statements is
    // momentarily ownerless, and only the state at commit is a real state.
    const successor = await seedMember("admin");
    await pg.query("begin");
    await pg.query(
      `update public.organization_members set role = 'admin'
       where organization_id = $1 and role = 'owner'`,
      [orgId]
    );
    await pg.query(
      `update public.organization_members set role = 'owner'
       where organization_id = $1 and user_id = $2`,
      [orgId, successor]
    );
    await pg.query("commit");

    expect(await owners()).toBe(1);
  });

  it("still lets the whole Organization be deleted", async () => {
    // The cascade removes the members before the parent row, so a check that
    // ran per statement would refuse this. An Organization that no longer
    // exists cannot be left without an Owner.
    const doomed = randomUUID();
    await pg.query(`insert into public.organizations (id, name) values ($1, $2)`, [
      doomed,
      "Closing Down U",
    ]);
    const userId = randomUUID();
    await pg.query(`insert into auth.users (id) values ($1)`, [userId]);
    await pg.query(
      `insert into public.organization_members (organization_id, user_id, role)
       values ($1, $2, 'owner')`,
      [doomed, userId]
    );

    await expect(
      pg.query(`delete from public.organizations where id = $1`, [doomed])
    ).resolves.toBeTruthy();
  });
});
