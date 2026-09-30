import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createSchemaLoadedPglite } from "./supabase-contract-harness";

/**
 * Who may delete an API key row (`20260929140000_api_keys_delete_revoked`):
 * an Admin or Owner of the key's own Organization, and only once the key is
 * revoked. The row is the key's audit trail, so the two conditions are the
 * whole of what stands between a click and losing it.
 *
 * The contract suite connects as a superuser and never reaches RLS, so every
 * assertion here deletes as `authenticated` with the caller's id in the JWT
 * claim, which is how PostgREST reaches the table with a Member's own token.
 * A refused delete is not an error in Postgres: the policy filters the row
 * out and zero rows go, which is what `returning` counts.
 */

const GRANT_LIKE_SUPABASE = `
  grant usage on schema public to anon, authenticated;
  grant usage on schema private to anon, authenticated;
  grant select, insert, update, delete
    on all tables in schema public to authenticated;
`;

let pg: PGlite;
let orgA: string;
let orgB: string;
const members: Record<"owner" | "admin" | "editor" | "viewer" | "adminB", string> = {
  owner: "",
  admin: "",
  editor: "",
  viewer: "",
  adminB: "",
};

async function seedUser(email: string, org: string, role: string): Promise<string> {
  const id = randomUUID();
  await pg.query(
    `insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, '{}')`,
    [id, email]
  );
  await pg.query(
    `insert into public.organization_members (organization_id, user_id, role)
     values ($1, $2, $3)
     on conflict (organization_id, user_id) do update set role = excluded.role`,
    [org, id, role]
  );
  return id;
}

/** Inserts a key as the superuser and returns its id. */
async function seedKey(org: string, revoked: boolean): Promise<string> {
  const id = randomUUID();
  await pg.query(
    `insert into public.organization_api_keys
       (id, organization_id, name, secret_hash, secret_hint, role, revoked_at)
     values ($1, $2, 'Key', $3, 'ciele_sk_ab12', 'viewer', $4)`,
    [id, org, `hash-${id}`, revoked ? new Date().toISOString() : null]
  );
  return id;
}

/** Deletes a key as `userId` and returns how many rows went. */
async function deleteAs(userId: string, keyId: string): Promise<number> {
  await pg.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId]);
  await pg.exec("set role authenticated");
  try {
    const { rows } = await pg.query(
      `delete from public.organization_api_keys where id = $1 returning id`,
      [keyId]
    );
    return rows.length;
  } finally {
    await pg.exec("reset role");
  }
}

async function stillThere(keyId: string): Promise<boolean> {
  const { rows } = await pg.query(`select 1 from public.organization_api_keys where id = $1`, [
    keyId,
  ]);
  return rows.length === 1;
}

beforeAll(async () => {
  pg = await createSchemaLoadedPglite();
  orgA = randomUUID();
  orgB = randomUUID();
  await pg.query(`insert into public.organizations (id, name) values ($1, 'A'), ($2, 'B')`, [
    orgA,
    orgB,
  ]);
  members.owner = await seedUser("owner@akd.test", orgA, "owner");
  members.admin = await seedUser("admin@akd.test", orgA, "admin");
  members.editor = await seedUser("editor@akd.test", orgA, "editor");
  members.viewer = await seedUser("viewer@akd.test", orgA, "viewer");
  members.adminB = await seedUser("admin@akd-b.test", orgB, "admin");
  await pg.exec(GRANT_LIKE_SUPABASE);
});

afterAll(async () => {
  await pg?.close();
});

describe("deleting an API key row", () => {
  it("lets an Admin or an Owner delete a revoked key of their own Organization", async () => {
    for (const who of ["admin", "owner"] as const) {
      const key = await seedKey(orgA, true);
      expect(await deleteAs(members[who], key)).toBe(1);
      expect(await stillThere(key)).toBe(false);
    }
  });

  it("refuses an active key, even to an Owner", async () => {
    const key = await seedKey(orgA, false);
    expect(await deleteAs(members.owner, key)).toBe(0);
    expect(await stillThere(key)).toBe(true);
  });

  it("refuses an Editor and a Viewer, revoked or not", async () => {
    const key = await seedKey(orgA, true);
    for (const who of ["editor", "viewer"] as const) {
      expect(await deleteAs(members[who], key)).toBe(0);
    }
    expect(await stillThere(key)).toBe(true);
  });

  it("refuses an Admin of another Organization", async () => {
    const key = await seedKey(orgA, true);
    expect(await deleteAs(members.adminB, key)).toBe(0);
    expect(await stillThere(key)).toBe(true);
  });
});
