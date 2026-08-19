import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createSchemaLoadedPglite } from "./supabase-contract-harness";

/**
 * RLS enforcement for per-assistant access overrides (PRD #296, #297).
 *
 * The contract harness runs queries as the PGlite superuser, which BYPASSES
 * row-level security, fine for adapter semantics, useless for proving the
 * policies. This suite drops to the `authenticated` role (granting it the
 * table privileges the Supabase platform normally grants project-wide) so
 * `private.has_assistant_role` and the rewritten "members read assistants"
 * policy are exercised for real: the resolver truth table, the denied
 * member's invisibility, owner/superuser exemption, and the admin-only
 * write policies on assistant_access.
 */

const ORG = randomUUID();
const ASSISTANT = "acc-rls-a1";

// One user per row of the resolver truth table.
const OWNER = randomUUID(); // org owner + a 'denied' row → exempt, still sees it
const ADMIN = randomUUID(); // org admin lowered to 'viewer' → rank 1
const EDITOR = randomUUID(); // org editor, no override → "System Role", rank 2
const VIEWER = randomUUID(); // org viewer raised to 'editor' → rank 2
const DENIED = randomUUID(); // org viewer with 'denied' → rank 0, invisible
const OUTSIDER = randomUUID(); // no membership at all
const SUPERUSER = randomUUID(); // platform superuser, no membership, 'denied' row

describe("assistant access RLS (supabase)", () => {
  let pg: PGlite;

  const asUser = async (userId: string) => {
    await pg.exec("reset role;");
    await pg.query(`select set_config('request.jwt.claim.sub', $1, false)`, [
      userId,
    ]);
    await pg.exec("set role authenticated;");
  };
  const asSuperuserRole = async () => {
    await pg.exec("reset role;");
  };

  const hasRole = async (minRank: number) => {
    const res = await pg.query<{ ok: boolean }>(
      `select private.has_assistant_role($1, $2) as ok`,
      [ASSISTANT, minRank]
    );
    return res.rows[0].ok;
  };

  const visibleAssistants = async () => {
    const res = await pg.query<{ n: number }>(
      `select count(*)::int as n from public.assistants where id = $1`,
      [ASSISTANT]
    );
    return res.rows[0].n;
  };

  beforeAll(async () => {
    pg = await createSchemaLoadedPglite();

    // The Supabase platform grants table privileges to `authenticated` via
    // default privileges outside any migration; mirror that here so dropping
    // to the role tests RLS, not missing GRANTs.
    await pg.exec(`
      grant usage on schema public to authenticated;
      grant select, insert, update, delete on all tables in schema public to authenticated;
      grant usage, select on all sequences in schema public to authenticated;
    `);

    for (const [id, email] of [
      [OWNER, "owner@rls-test.edu"],
      [ADMIN, "admin@rls-test.edu"],
      [EDITOR, "editor@rls-test.edu"],
      [VIEWER, "viewer@rls-test.edu"],
      [DENIED, "denied@rls-test.edu"],
      [OUTSIDER, "outsider@rls-test.edu"],
      [SUPERUSER, "super@rls-test.edu"],
    ] as const) {
      await pg.query(
        `insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, '{}')`,
        [id, email]
      );
    }
    await pg.query(
      `insert into private.platform_superusers (user_id) values ($1)`,
      [SUPERUSER]
    );

    await pg.query(`insert into public.organizations (id, name) values ($1, 'RLS Org')`, [ORG]);
    for (const [user, role] of [
      [OWNER, "owner"],
      [ADMIN, "admin"],
      [EDITOR, "editor"],
      [VIEWER, "viewer"],
      [DENIED, "viewer"],
    ] as const) {
      await pg.query(
        `insert into public.organization_members (organization_id, user_id, role) values ($1, $2, $3)`,
        [ORG, user, role]
      );
    }

    await pg.query(
      `insert into public.assistants (id, title, organization_id) values ($1, 'RLS Fixture', $2)`,
      [ASSISTANT, ORG]
    );

    for (const [user, role] of [
      [OWNER, "denied"], // must be ignored: owners are exempt
      [ADMIN, "viewer"], // lowering an org admin
      [VIEWER, "editor"], // raising an org viewer
      [DENIED, "denied"],
      [SUPERUSER, "denied"], // must be ignored: superusers are exempt
    ] as const) {
      await pg.query(
        `insert into public.assistant_access (assistant_id, user_id, role) values ($1, $2, $3)`,
        [ASSISTANT, user, role]
      );
    }
  }, 120_000);

  afterAll(async () => {
    await pg?.close();
  });

  it("resolver: org owner is exempt from overrides (even 'denied')", async () => {
    await asUser(OWNER);
    expect(await hasRole(3)).toBe(true);
    expect(await hasRole(4)).toBe(true); // full org rank, not the override
    expect(await visibleAssistants()).toBe(1);
  });

  it("resolver: platform superuser bypasses everything without membership", async () => {
    await asUser(SUPERUSER);
    expect(await hasRole(3)).toBe(true);
    expect(await visibleAssistants()).toBe(1);
  });

  it("resolver: override lowers an org admin to viewer", async () => {
    await asUser(ADMIN);
    expect(await hasRole(1)).toBe(true);
    expect(await hasRole(2)).toBe(false); // no longer editor-capable here
    expect(await visibleAssistants()).toBe(1); // still visible (viewer)
  });

  it("resolver: override raises an org viewer to editor", async () => {
    await asUser(VIEWER);
    expect(await hasRole(2)).toBe(true);
    expect(await hasRole(3)).toBe(false);
  });

  it("resolver: no override means the org role applies (System Role)", async () => {
    await asUser(EDITOR);
    expect(await hasRole(2)).toBe(true);
    expect(await hasRole(3)).toBe(false);
    expect(await visibleAssistants()).toBe(1);
  });

  it("denied member cannot see the assistant at all", async () => {
    await asUser(DENIED);
    expect(await hasRole(1)).toBe(false);
    expect(await visibleAssistants()).toBe(0);
  });

  it("non-member sees nothing", async () => {
    await asUser(OUTSIDER);
    expect(await hasRole(1)).toBe(false);
    expect(await visibleAssistants()).toBe(0);
  });

  it("clearing the denied row restores visibility (System Role again)", async () => {
    await asSuperuserRole();
    await pg.query(
      `delete from public.assistant_access where assistant_id = $1 and user_id = $2`,
      [ASSISTANT, DENIED]
    );
    await asUser(DENIED);
    expect(await hasRole(1)).toBe(true); // back to org viewer
    expect(await visibleAssistants()).toBe(1);

    // Re-seed for any later cases.
    await asSuperuserRole();
    await pg.query(
      `insert into public.assistant_access (assistant_id, user_id, role) values ($1, $2, 'denied')`,
      [ASSISTANT, DENIED]
    );
  });

  it("write policies: org admins can grant, editors cannot", async () => {
    await asUser(ADMIN); // org role admin, per-assistant 'viewer' must NOT matter
    await pg.query(
      `insert into public.assistant_access (assistant_id, user_id, role) values ($1, $2, 'viewer')`,
      [ASSISTANT, OUTSIDER]
    );
    await asSuperuserRole();
    const granted = await pg.query<{ granted_by: string }>(
      `select granted_by from public.assistant_access where assistant_id = $1 and user_id = $2`,
      [ASSISTANT, OUTSIDER]
    );
    // Audit trigger stamped the caller, whatever the client sent.
    expect(granted.rows[0].granted_by).toBe(ADMIN);

    await asUser(EDITOR); // org role editor, below the admin bar
    await expect(
      pg.query(
        `insert into public.assistant_access (assistant_id, user_id, role) values ($1, $2, 'admin')`,
        [ASSISTANT, EDITOR]
      )
    ).rejects.toThrow(/row-level security/);
  });

  it("read policy: only org admins see override rows", async () => {
    const countRows = async () => {
      const res = await pg.query<{ n: number }>(
        `select count(*)::int as n from public.assistant_access where assistant_id = $1`,
        [ASSISTANT]
      );
      return res.rows[0].n;
    };
    await asUser(ADMIN);
    expect(await countRows()).toBeGreaterThan(0);
    await asUser(EDITOR);
    expect(await countRows()).toBe(0); // RLS filters, doesn't error
  });
});
