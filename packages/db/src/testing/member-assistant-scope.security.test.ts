import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createSchemaLoadedPglite } from "./supabase-contract-harness";

/**
 * A Member limited to selected Assistants (20261104132000), asked as
 * `authenticated`, the way PostgREST asks: the pglite superuser walks past
 * every policy (see assistant-access-rls.test.ts).
 */

const ORG = randomUUID();
const OWNER = randomUUID();
const ADMIN = randomUUID();
const LIMITED = randomUUID();
const EDITOR = randomUUID();
const LISTED = "scope-listed";
const UNLISTED = "scope-unlisted";

describe("member assistant scope (supabase)", () => {
  let pg: PGlite;

  const asUser = async (userId: string) => {
    await pg.exec("reset role;");
    await pg.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId]);
    await pg.exec("set role authenticated;");
  };
  const visible = async () =>
    (
      await pg.query<{ id: string }>(
        `select id from public.assistants where organization_id = $1 order by id`,
        [ORG]
      )
    ).rows.map((row) => row.id);

  beforeAll(async () => {
    pg = await createSchemaLoadedPglite();
    await pg.exec(`
      grant usage on schema public to authenticated;
      grant usage on schema private to authenticated;
      grant select, insert, update, delete on all tables in schema public to authenticated;
      grant usage, select on all sequences in schema public to authenticated;
    `);
    for (const [id, email] of [
      [OWNER, "owner@scope-test.example"],
      [ADMIN, "admin@scope-test.example"],
      [LIMITED, "limited@scope-test.example"],
      [EDITOR, "editor@scope-test.example"],
    ] as const) {
      await pg.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, '{}')`, [id, email]);
    }
    await pg.query(`insert into public.organizations (id, name) values ($1, 'Scope Org')`, [ORG]);
    for (const [user, role] of [
      [OWNER, "owner"],
      [ADMIN, "admin"],
      [LIMITED, "editor"],
      [EDITOR, "editor"],
    ] as const) {
      await pg.query(
        `insert into public.organization_members (organization_id, user_id, role) values ($1, $2, $3)`,
        [ORG, user, role]
      );
    }
    for (const id of [LISTED, UNLISTED]) {
      await pg.query(`insert into public.assistants (id, title, organization_id) values ($1, $1, $2)`, [id, ORG]);
    }
  });

  afterAll(async () => {
    await pg?.close();
  });

  it("refuses the scope setter to anyone below Admin", async () => {
    await asUser(EDITOR);
    await expect(
      pg.query(`select public.set_member_assistant_scope($1, $2, 'selected', '[]'::jsonb)`, [ORG, LIMITED])
    ).rejects.toThrow(/Forbidden/);
    await pg.exec("reset role;");
  });

  it("refuses to limit an Owner", async () => {
    await asUser(ADMIN);
    await expect(
      pg.query(`select public.set_member_assistant_scope($1, $2, 'selected', '[]'::jsonb)`, [ORG, OWNER])
    ).rejects.toThrow(/owner/);
    await pg.exec("reset role;");
  });

  it("shows a limited Member only the Assistants they have a row for, at that row's Role", async () => {
    await asUser(ADMIN);
    await pg.query(
      `select public.set_member_assistant_scope($1, $2, 'selected', $3::jsonb)`,
      [ORG, LIMITED, JSON.stringify([{ assistant_id: LISTED, role: "viewer" }])]
    );
    await asUser(LIMITED);
    expect(await visible()).toEqual([LISTED]);
    const roles = await pg.query<{ read: boolean; write: boolean }>(
      `select private.has_assistant_role($1, 1) as read, private.has_assistant_role($1, 2) as write`,
      [LISTED]
    );
    // An Editor limited to Viewer on the one Assistant they keep.
    expect(roles.rows[0]).toEqual({ read: true, write: false });
    // Everyone else is unaffected.
    await asUser(EDITOR);
    expect(await visible()).toEqual([LISTED, UNLISTED].sort());
    await pg.exec("reset role;");
  });

  it("gives a limited creator access to the Assistant they create", async () => {
    await asUser(LIMITED);
    await pg.query(`insert into public.assistants (id, title, organization_id) values ('scope-created', 'Mine', $1)`, [ORG]);
    expect(await visible()).toEqual([LISTED, "scope-created"].sort());
    await pg.exec("reset role;");
    const row = await pg.query<{ role: string }>(
      `select role::text from public.assistant_access where assistant_id = 'scope-created' and user_id = $1`,
      [LIMITED]
    );
    expect(row.rows[0]?.role).toBe("editor");
  });

  it("puts a Member back on every Assistant when the scope returns to all", async () => {
    await asUser(ADMIN);
    await pg.query(`select public.set_member_assistant_scope($1, $2, 'all', '[]'::jsonb)`, [ORG, LIMITED]);
    await asUser(LIMITED);
    expect(await visible()).toEqual([LISTED, UNLISTED, "scope-created"].sort());
    await pg.exec("reset role;");
  });
});
