import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  CAPABILITY_CATALOG,
  BUILTIN_ROLE_KEYS,
  builtinRoleDefaults,
  roleTierFor,
} from "@agent-hub/core";
import { createSchemaLoadedPglite } from "./supabase-contract-harness";

/**
 * Custom Roles (20261104140000, ADR-0028), asked as `authenticated`, the way
 * PostgREST asks: the pglite superuser walks past every policy.
 */

const ORG = randomUUID();
const OWNER = randomUUID();
const ADMIN = randomUUID();
const EDITOR = randomUUID();
const OUTSIDER = randomUUID();
const PUBLISHER = randomUUID();

describe("custom roles (supabase)", () => {
  let pg: PGlite;

  const asUser = async (userId: string) => {
    await pg.exec("reset role;");
    await pg.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId]);
    await pg.exec("set role authenticated;");
  };
  const asSuperuser = () => pg.exec("reset role;");
  const roleId = async (key: string) =>
    (await pg.query<{ id: string }>(`select id from public.org_roles where organization_id = $1 and key = $2`, [ORG, key])).rows[0]!.id;
  const memberRole = async (userId: string) =>
    (await pg.query<{ role: string; role_id: string }>(
      `select role::text, role_id from public.organization_members where organization_id = $1 and user_id = $2`,
      [ORG, userId]
    )).rows[0]!;
  const createRole = (name: string, capabilities: string[]) =>
    pg.query<{ id: string; tier: string }>(
      `insert into public.org_roles (organization_id, name, capabilities) values ($1, $2, $3) returning id, tier::text`,
      [ORG, name, capabilities]
    );

  beforeAll(async () => {
    pg = await createSchemaLoadedPglite();
    await pg.exec(`
      grant usage on schema public to authenticated;
      grant usage on schema private to authenticated;
      -- What Supabase grants out of band, so auth.uid() resolves for the invoker.
      grant usage on schema auth to authenticated;
      grant execute on all functions in schema auth to authenticated;
      grant select, insert, update, delete on all tables in schema public to authenticated;
      grant usage, select on all sequences in schema public to authenticated;
    `);
    for (const id of [OWNER, ADMIN, EDITOR, OUTSIDER, PUBLISHER]) {
      await pg.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, '{}')`, [id, `${id}@roles-test.example`]);
    }
    await pg.query(`insert into public.organizations (id, name) values ($1, 'Roles Org')`, [ORG]);
    for (const [user, role] of [[OWNER, "owner"], [ADMIN, "admin"], [EDITOR, "editor"], [PUBLISHER, "viewer"]] as const) {
      // Written the old way, with a ladder name only.
      await pg.query(`insert into public.organization_members (organization_id, user_id, role) values ($1, $2, $3)`, [ORG, user, role]);
    }
  });

  afterAll(async () => {
    await pg?.close();
  });

  it("keeps the SQL catalogue and built-in defaults equal to packages/core", async () => {
    const rows = (await pg.query<{ id: string; tier: string; requires: string[] }>(
      `select id, tier, requires from private.capability_catalog order by position`
    )).rows;
    expect(rows).toEqual(CAPABILITY_CATALOG.map(({ id, tier, requires }) => ({ id, tier, requires: [...requires] })));
    for (const key of BUILTIN_ROLE_KEYS) {
      const sql = (await pg.query<{ d: string[] }>(`select private.builtin_role_defaults($1) as d`, [key])).rows[0]!.d;
      expect(sql, key).toEqual(builtinRoleDefaults(key));
      // The tier RLS sees, derived the same way on both sides.
      const tier = (await pg.query<{ t: string }>(`select private.capability_tier($1)::text as t`, [sql])).rows[0]!.t;
      expect(tier, key).toBe(roleTierFor(sql));
    }
  });

  it("seeds six built-ins for a new Organization and maps a ladder-name write onto them", async () => {
    const keys = (await pg.query<{ key: string; tier: string }>(
      `select key, tier::text from public.org_roles where organization_id = $1 order by key`, [ORG]
    )).rows;
    expect(keys.map((row) => row.key)).toEqual(["admin", "data_viewer", "editor", "owner", "support_agent", "viewer"]);
    expect(keys.find((row) => row.key === "data_viewer")!.tier).toBe("viewer");
    expect(await memberRole(EDITOR)).toEqual({ role: "editor", role_id: await roleId("editor") });
  });

  it("derives a custom Role's tier and moves its holders when it changes", async () => {
    await asUser(ADMIN);
    const created = (await createRole("Publisher", ["assistants:view", "assistants:publish"])).rows[0]!;
    expect(created.tier).toBe("admin");
    await pg.query(`update public.organization_members set role_id = $1 where organization_id = $2 and user_id = $3`, [created.id, ORG, PUBLISHER]);
    expect((await memberRole(PUBLISHER)).role).toBe("admin");

    await pg.query(`update public.org_roles set capabilities = '{assistants:view,inbox:view,inbox:operate}' where id = $1`, [created.id]);
    expect((await memberRole(PUBLISHER)).role).toBe("support_agent");
    await asSuperuser();
  });

  it("saves a directly written Role closed over what it requires", async () => {
    await asUser(OWNER);
    const role = (await pg.query<{ capabilities: string[] }>(
      `insert into public.org_roles (organization_id, name, capabilities) values ($1, 'Closure', '{flows:edit}') returning capabilities`,
      [ORG]
    )).rows[0]!;
    expect(role.capabilities).toEqual(["assistants:view", "flows:view", "flows:edit"]);
    await pg.query(`delete from public.org_roles where organization_id = $1 and name = 'Closure'`, [ORG]);
    await asSuperuser();
  });

  it("refuses unknown and Owner-only Capabilities", async () => {
    await asUser(OWNER);
    await expect(createRole("Typo", ["flows:edti"])).rejects.toThrow(/Unknown capability/);
    await expect(createRole("Owner-ish", ["personalSubscriptions:manage"])).rejects.toThrow(/Owner role alone/);
    await asSuperuser();
  });

  it("keeps Owner locked, whatever is written to it", async () => {
    await asUser(OWNER);
    await pg.query(`update public.org_roles set capabilities = '{}', name = 'Boss' where id = $1`, [await roleId("owner")]);
    await asSuperuser();
    const owner = (await pg.query<{ name: string; capabilities: string[] }>(`select name, capabilities from public.org_roles where id = $1`, [await roleId("owner")])).rows[0]!;
    expect(owner.name).toBe("Owner");
    expect(owner.capabilities).toEqual(builtinRoleDefaults("owner"));
  });

  it("does not let a Member hand on, or give themselves, what they do not hold", async () => {
    // The Owner takes API key management away from Admins.
    await asUser(OWNER);
    const adminDefaults = builtinRoleDefaults("admin").filter((id) => id !== "apiKeys:manage");
    await pg.query(`update public.org_roles set capabilities = $1 where id = $2`, [adminDefaults, await roleId("admin")]);

    await asUser(ADMIN);
    await expect(createRole("Key minter", ["apiKeys:manage"])).rejects.toThrow(/do not hold/);
    await expect(
      pg.query(`update public.org_roles set capabilities = $1 where id = $2`, [builtinRoleDefaults("admin"), await roleId("admin")])
    ).rejects.toThrow(/(do not hold|Role you hold)/);
    await expect(
      pg.query(`update public.org_roles set description = 'mine now' where id = $1`, [await roleId("admin")])
    ).rejects.toThrow(/Role you hold/);
    // Nor promote someone to a Role above their own.
    await expect(
      pg.query(`update public.organization_members set role_id = $1 where organization_id = $2 and user_id = $3`, [await roleId("owner"), ORG, EDITOR])
    ).rejects.toThrow();
    await asSuperuser();

    await asUser(OWNER);
    await pg.query(`update public.org_roles set capabilities = $1 where id = $2`, [builtinRoleDefaults("admin"), await roleId("admin")]);
    await asSuperuser();
    const admin = (await pg.query<{ customized: boolean }>(`select customized from public.org_roles where id = $1`, [await roleId("admin")])).rows[0]!;
    expect(admin.customized).toBe(false);
  });

  it("checks the privilege tables by Capability, not by tier", async () => {
    // At the Admin tier, without members:manage or apiKeys:manage.
    await asUser(OWNER);
    const publishOnly = (await createRole("Publish only", ["assistants:view", "assistants:publish"])).rows[0]!;
    await pg.query(`update public.organization_members set role_id = $1 where organization_id = $2 and user_id = $3`, [publishOnly.id, ORG, PUBLISHER]);
    await pg.query(
      `insert into public.organization_invites (organization_id, email, role, token) values ($1, 'x@roles-test.example', 'viewer', 'tok-1')`,
      [ORG]
    );

    await asUser(PUBLISHER);
    expect((await memberRole(PUBLISHER)).role).toBe("admin");
    const changed = await pg.query(
      `update public.organization_members set role = 'viewer' where organization_id = $1 and user_id = $2 returning user_id`,
      [ORG, EDITOR]
    );
    expect(changed.rows).toEqual([]);
    expect((await pg.query(`select id from public.organization_invites where organization_id = $1`, [ORG])).rows).toEqual([]);
    await expect(createRole("Sneaky", ["assistants:view"])).rejects.toThrow();
    await asSuperuser();
    expect((await memberRole(EDITOR)).role).toBe("editor");
  });

  it("follows inbox:operate for taking over a conversation", async () => {
    await asUser(OWNER);
    const noOperate = builtinRoleDefaults("editor").filter((id) => id !== "inbox:operate");
    await pg.query(`update public.org_roles set capabilities = $1 where id = $2`, [noOperate, await roleId("editor")]);
    await asUser(EDITOR);
    expect((await pg.query<{ ok: boolean }>(`select private.can_operate_conversations($1) as ok`, [ORG])).rows[0]!.ok).toBe(false);
    await asUser(OWNER);
    await pg.query(`update public.org_roles set capabilities = $1 where id = $2`, [builtinRoleDefaults("editor"), await roleId("editor")]);
    await asUser(EDITOR);
    expect((await pg.query<{ ok: boolean }>(`select private.can_operate_conversations($1) as ok`, [ORG])).rows[0]!.ok).toBe(true);
    await asSuperuser();
  });

  it("carries an invitation's Role onto the new membership", async () => {
    await asUser(OWNER);
    const triage = (await createRole("Triage", ["inbox:view", "inbox:triage"])).rows[0]!;
    await pg.query(
      `insert into public.organization_invites (organization_id, email, role_id, token) values ($1, 'new@roles-test.example', $2, 'tok-2')`,
      [ORG, triage.id]
    );
    await asUser(OUTSIDER);
    await pg.query(`select public.accept_invite('tok-2')`);
    await asSuperuser();
    expect(await memberRole(OUTSIDER)).toEqual({ role: "viewer", role_id: triage.id });
  });

  it("never deletes a built-in, refuses a held custom Role and deletes an unheld one", async () => {
    await asUser(OWNER);
    const deleted = await pg.query(`delete from public.org_roles where id = $1 returning id`, [await roleId("viewer")]);
    expect(deleted.rows).toEqual([]);
    const held = (await pg.query<{ id: string }>(`select role_id as id from public.organization_members where user_id = $1`, [OUTSIDER])).rows[0]!.id;
    await expect(pg.query(`delete from public.org_roles where id = $1`, [held])).rejects.toThrow();
    const spare = (await createRole("Spare", ["inbox:view"])).rows[0]!;
    expect((await pg.query(`delete from public.org_roles where id = $1 returning id`, [spare.id])).rows).toHaveLength(1);
    await asSuperuser();
  });

  it("lets an Organization go, built-ins and all", async () => {
    const doomed = randomUUID();
    await pg.query(`insert into public.organizations (id, name) values ($1, 'Doomed')`, [doomed]);
    await pg.query(`insert into public.organization_members (organization_id, user_id, role) values ($1, $2, 'owner')`, [doomed, OUTSIDER]);
    await pg.query(`delete from public.organizations where id = $1`, [doomed]);
    expect((await pg.query(`select id from public.org_roles where organization_id = $1`, [doomed])).rows).toEqual([]);
  });

  it("fences what a partial admin could otherwise use to reach further", async () => {
    // A Role that manages API keys and members, and holds nothing else.
    await asUser(OWNER);
    const keyKeeper = (await createRole("Key keeper", ["apiKeys:manage", "members:manage", "members:view"])).rows[0]!;
    await pg.query(`update public.organization_members set role_id = $1 where organization_id = $2 and user_id = $3`, [keyKeeper.id, ORG, PUBLISHER]);
    // The Owner mints an Admin key and invites an Admin.
    const key = (await pg.query<{ id: string }>(
      `insert into public.organization_api_keys (organization_id, name, secret_hash, secret_hint, role_id, created_by)
       values ($1, 'owner key', 'hash-owner', 'ciele_sk_o', $2, $3) returning id`,
      [ORG, await roleId("admin"), OWNER]
    )).rows[0]!;
    await pg.query(
      `insert into public.organization_invites (organization_id, email, role_id, token) values ($1, 'boss@roles-test.example', $2, 'tok-admin')`,
      [ORG, await roleId("admin")]
    );

    await asUser(PUBLISHER);
    // Re-pointing the Owner's key at a secret they know.
    await expect(
      pg.query(`update public.organization_api_keys set secret_hash = 'hash-mine' where id = $1`, [key.id])
    ).rejects.toThrow(/Only revoking/);
    // Minting a key in someone else's name.
    await expect(
      pg.query(
        `insert into public.organization_api_keys (organization_id, name, secret_hash, secret_hint, role_id, created_by)
         values ($1, 'forged', 'hash-forged', 'ciele_sk_f', $2, $3)`,
        [ORG, keyKeeper.id, OWNER]
      )
    ).rejects.toThrow(/created by the Member/);
    // Moving an Admin's seat to another account.
    await expect(
      pg.query(`update public.organization_members set user_id = $1 where organization_id = $2 and user_id = $3`, [OUTSIDER, ORG, ADMIN])
    ).rejects.toThrow(/cannot move/);
    // Reading the Admin invitation's token.
    expect((await pg.query(`select token from public.organization_invites where token = 'tok-admin'`)).rows).toEqual([]);
    // Revoking is still theirs to do.
    expect((await pg.query(`update public.organization_api_keys set revoked_at = now() where id = $1 returning id`, [key.id])).rows).toHaveLength(1);
    await expect(
      pg.query(`update public.organization_api_keys set revoked_at = null where id = $1`, [key.id])
    ).rejects.toThrow(/Only revoking/);
    await asSuperuser();
  });

  it("checks the Capability of each area in RLS, not the tier, and the Role on one Assistant", async () => {
    // At the Editor tier, holding Flows and nothing else of an Editor's.
    await asUser(OWNER);
    const flowOnly = (await createRole("Flow only", ["flows:edit"])).rows[0]!;
    await pg.query(`update public.organization_members set role_id = $1 where organization_id = $2 and user_id = $3`, [flowOnly.id, ORG, PUBLISHER]);
    const assistant = "rls-cap-assistant";
    await pg.query(`insert into public.assistants (id, title, organization_id) values ($1, 'RLS cap', $2)`, [assistant, ORG]);

    await asUser(PUBLISHER);
    expect((await memberRole(PUBLISHER)).role).toBe("editor");
    await pg.query(`insert into public.flows (id, assistant_id, name, description) values ('rls-flow', $1, 'F', '')`, [assistant]);
    // An Editor's other writes are refused: no assistants:edit, no quickTexts:edit.
    expect((await pg.query(`update public.assistants set title = 'renamed' where id = $1 returning id`, [assistant])).rows).toEqual([]);
    await expect(
      pg.query(`insert into public.quick_texts (organization_id, title, body) values ($1, 'T', 'B')`, [ORG])
    ).rejects.toThrow(/row-level security/);
    // As the Owner: the pglite superuser keeps the last caller's id in the JWT
    // claim, which the hand-on check would read.
    await asUser(OWNER);

    // An Organization Viewer given Editor on this one Assistant writes its Flows there.
    await pg.query(`update public.organization_members set role_id = $1 where organization_id = $2 and user_id = $3`, [await roleId("viewer"), ORG, PUBLISHER]);
    await pg.query(`insert into public.assistant_access (assistant_id, user_id, role) values ($1, $2, 'editor')`, [assistant, PUBLISHER]);
    await asUser(PUBLISHER);
    expect((await pg.query(`update public.flows set name = 'F2' where id = 'rls-flow' returning id`)).rows).toHaveLength(1);
    expect((await pg.query<{ ok: boolean }>(`select private.has_assistant_capability($1, 'flows:edit') as ok`, [assistant])).rows[0]!.ok).toBe(true);
    expect((await pg.query<{ ok: boolean }>(`select private.has_assistant_capability($1, 'assistants:delete') as ok`, [assistant])).rows[0]!.ok).toBe(false);
    await asSuperuser();
  });

  it("keeps personal AI subscriptions the Owner's, whatever else an Admin may change", async () => {
    await asUser(ADMIN);
    await expect(
      pg.query(`update public.organizations set allow_personal_ai_subscriptions = true where id = $1`, [ORG])
    ).rejects.toThrow(/Only an Owner/);
    expect((await pg.query(`update public.organizations set name = 'Renamed by admin' where id = $1 returning id`, [ORG])).rows).toHaveLength(1);
    await asSuperuser();
  });

  it("fences Assistant access rows and Assistants against being moved (review of #1164)", async () => {
    await asUser(OWNER);
    const assistant = "fence-assistant";
    await pg.query(`insert into public.assistants (id, title, organization_id) values ($1, 'Fence', $2)`, [assistant, ORG]);
    await pg.query(`insert into public.assistant_access (assistant_id, user_id, role) values ($1, $2, 'admin')`, [assistant, ADMIN]);
    // A Role that manages Members and nothing else.
    const memberManager = (await createRole("Member manager", ["members:view", "members:manage"])).rows[0]!;
    await pg.query(`update public.organization_members set role_id = $1 where organization_id = $2 and user_id = $3`, [memberManager.id, ORG, PUBLISHER]);

    await asUser(PUBLISHER);
    await expect(
      pg.query(`update public.assistant_access set user_id = $1 where assistant_id = $2 and user_id = $3`, [PUBLISHER, assistant, ADMIN])
    ).rejects.toThrow(/cannot move/);
    await asUser(EDITOR);
    const foreign = randomUUID();
    await asSuperuser();
    await pg.query(`insert into public.organizations (id, name) values ($1, 'Elsewhere')`, [foreign]);
    await asUser(EDITOR);
    await expect(
      pg.query(`update public.assistants set organization_id = $1 where id = $2`, [foreign, assistant])
    ).rejects.toThrow(/cannot move to another organization/);

    // A Member reads their own row, which is how the console finds their Role there.
    await asUser(ADMIN);
    expect((await pg.query(`select role from public.assistant_access where assistant_id = $1 and user_id = $2`, [assistant, ADMIN])).rows).toHaveLength(1);
    await asUser(EDITOR);
    expect((await pg.query(`select role from public.assistant_access where assistant_id = $1`, [assistant])).rows).toEqual([]);
    await asSuperuser();
  });
});
