import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createSchemaLoadedPglite } from "./supabase-contract-harness";

let pg: PGlite;
let organizationId: string;
let editor: string;
let admin: string;
let foreignAdmin: string;
const config = {
  harness: { kind: "ciele" },
  internet: true,
  computer: { browser: true, files: true, terminal: true },
};
async function user(org: string, role: string) {
  const id = randomUUID();
  await pg.query("insert into auth.users(id,email) values ($1,$2)", [
    id,
    id + "@execution.test",
  ]);
  await pg.query(
    "insert into public.organization_members(organization_id,user_id,role) values ($1,$2,$3)",
    [org, id, role],
  );
  return id;
}
async function actingAs(id: string, statement: string, values: unknown[] = []) {
  await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await pg.exec("set role authenticated");
  try {
    return await pg.query(statement, values);
  } finally {
    await pg.exec("reset role");
  }
}
beforeAll(async () => {
  pg = await createSchemaLoadedPglite();
  organizationId = randomUUID();
  const foreign = randomUUID();
  await pg.query(
    "insert into public.organizations(id,name) values ($1,'Execution'),($2,'Foreign')",
    [organizationId, foreign],
  );
  editor = await user(organizationId, "editor");
  admin = await user(organizationId, "admin");
  foreignAdmin = await user(foreign, "admin");
  await pg.query(
    "insert into public.teammates(id,organization_id,owner_id,name) values ('execution-test',$1,$2,'Computer coworker')",
    [organizationId, editor],
  );
  await pg.query(
    "insert into public.teammate_channels(id,organization_id,created_by,name) values ('execution-channel',$1,$2,'Harness state')",
    [organizationId, editor],
  );
  await pg.exec(
    "grant usage on schema public,private to authenticated; grant select,insert,update on public.teammates,public.teammate_channels to authenticated",
  );
}, 120000);
afterAll(async () => {
  await pg?.close();
});

describe("execution grants against authenticated Postgres roles", () => {
  it("allows an owner's persona edit but refuses an execution grant through direct PostgREST-style updates", async () => {
    expect(
      (
        await actingAs(
          editor,
          "update public.teammates set name = 'Renamed' where id = 'execution-test' returning id",
        )
      ).rows,
    ).toHaveLength(1);
    await expect(
      actingAs(
        editor,
        "update public.teammates set runtime_config = $1::jsonb where id = 'execution-test'",
        [JSON.stringify(config)],
      ),
    ).rejects.toThrow("Only an Organization admin");
  });
  it("allows an org admin to configure execution and hides the row from a foreign admin", async () => {
    expect(
      (
        await actingAs(
          admin,
          "update public.teammates set runtime_config = $1::jsonb where id = 'execution-test' returning id",
          [JSON.stringify(config)],
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await actingAs(
          foreignAdmin,
          "update public.teammates set runtime_config = null where id = 'execution-test' returning id",
        )
      ).rows,
    ).toEqual([]);
    expect(
      (
        await pg.query<{ runtime_config: unknown }>(
          "select runtime_config from public.teammates where id = 'execution-test'",
        )
      ).rows[0]?.runtime_config,
    ).toEqual(config);
  });
  it("does not let an editor arm a Teammate while inserting it", async () => {
    await expect(
      actingAs(
        editor,
        "insert into public.teammates(id,organization_id,owner_id,name,runtime_config) values ('armed-insert',$1,$2,'Armed',$3::jsonb)",
        [organizationId, editor, JSON.stringify(config)],
      ),
    ).rejects.toThrow("Only an Organization admin");
    expect(
      (
        await actingAs(
          editor,
          "insert into public.teammates(id,organization_id,owner_id,name) values ('plain-insert',$1,$2,'Plain') returning id",
          [organizationId, editor],
        )
      ).rows,
    ).toHaveLength(1);
  });
  it("validates direct admin writes against the same configuration shape and prerequisites", async () => {
    for (const invalid of [
      {},
      { ...config, computer: {} },
      { ...config, internet: false },
      {
        ...config,
        harness: {
          kind: "ag_ui",
          connectionId: "x",
          url: "https://attacker.example",
        },
      },
    ]) {
      await expect(
        actingAs(
          admin,
          "update public.teammates set runtime_config = $1::jsonb where id = 'execution-test'",
          [JSON.stringify(invalid)],
        ),
      ).rejects.toThrow("teammates_runtime_config_check");
    }
  });
  it("keeps harness state runtime-owned even for a channel administrator", async () => {
    await expect(
      actingAs(
        admin,
        "update public.teammate_channels set runtime_state = '{\"agui:override\":true}' where id = 'execution-channel'",
      ),
    ).rejects.toThrow("Only the runtime");
    await expect(
      actingAs(
        admin,
        "select public.merge_channel_runtime_state($1,'execution-channel','{}')",
        [organizationId],
      ),
    ).rejects.toThrow("permission denied");
    await pg.exec("set role service_role");
    try {
      expect(
        (
          await pg.query<{ merged: boolean }>(
            "select public.merge_channel_runtime_state($1,'execution-channel','{\"agui:one\":{\"count\":1}}') as merged",
            [organizationId],
          )
        ).rows,
      ).toEqual([{ merged: true }]);
      expect(
        (
          await pg.query<{ merged: boolean }>(
            "select public.merge_channel_runtime_state($1,'execution-channel','{}') as merged",
            [randomUUID()],
          )
        ).rows,
      ).toEqual([{ merged: false }]);
    } finally {
      await pg.exec("reset role");
    }
  });
});
