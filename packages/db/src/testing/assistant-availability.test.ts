import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createSchemaLoadedPglite } from "./supabase-contract-harness";

let pg: PGlite;
const org = randomUUID(),
  foreignOrg = randomUUID(),
  member = randomUUID();
beforeAll(async () => {
  pg = await createSchemaLoadedPglite();
  await pg.query(
    "insert into public.organizations(id,name) values($1,'Availability'),($2,'Foreign')",
    [org, foreignOrg],
  );
  await pg.query(
    "insert into auth.users(id,email) values($1,'availability@example.com')",
    [member],
  );
  await pg.query(
    "insert into public.organization_members(organization_id,user_id,role) values($1,$2,'editor')",
    [org, member],
  );
  await pg.query(
    "insert into public.assistants(id,organization_id,title) values('avail-own',$1,'Own'),('avail-foreign',$2,'Foreign')",
    [org, foreignOrg],
  );
  await pg.query(
    "insert into public.assistant_availability_checks(assistant_id,organization_id,checked_at,status,latency_ms) values('avail-own',$1,now(),'up',100),('avail-foreign',$2,now(),'down',5000)",
    [org, foreignOrg],
  );
  await pg.exec(
    "grant usage on schema public,private to authenticated; grant select on public.assistants,public.publications to authenticated;",
  );
}, 120000);
afterAll(async () => {
  await pg?.close();
});
async function asMember(sql: string, params: unknown[] = []) {
  await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [
    member,
  ]);
  await pg.exec("set role authenticated");
  try {
    return await pg.query(sql, params);
  } finally {
    await pg.exec("reset role");
  }
}
describe("availability isolation", () => {
  it("enforces member reads on the table and aggregate function", async () => {
    expect(
      (
        await asMember(
          "select assistant_id from public.assistant_availability_checks",
        )
      ).rows,
    ).toEqual([{ assistant_id: "avail-own" }]);
    expect(
      (
        await asMember(
          "select * from public.org_assistant_availability($1,now()-interval '1 day',now()+interval '1 day')",
          [foreignOrg],
        )
      ).rows,
    ).toEqual([]);
    expect(
      (
        await asMember(
          "select * from public.org_assistant_availability($1,now()-interval '1 day',now()+interval '1 day')",
          [org],
        )
      ).rows,
    ).toHaveLength(1);
  });
  it("refuses authenticated writes and unscoped target enumeration", async () => {
    await expect(
      asMember("delete from public.assistant_availability_checks"),
    ).rejects.toThrow(/permission denied/);
    expect(
      (
        await asMember(
          "select * from public.published_availability_targets(null,200)",
        )
      ).rows,
    ).toEqual([]);
  });
  it("rejects misattributed samples at the database boundary", async () => {
    await expect(
      pg.query(
        "insert into public.assistant_availability_checks(assistant_id,organization_id,checked_at,status,latency_ms) values('avail-own',$1,now()-interval '1 hour','up',10)",
        [foreignOrg],
      ),
    ).rejects.toThrow(/foreign key/);
  });
});
