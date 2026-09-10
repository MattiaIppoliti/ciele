import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createSchemaLoadedPglite } from "./supabase-contract-harness";

/**
 * Who may read and who may write a Webhook Subscription (#842), against the
 * shipping migration `20260909120000_webhook_subscriptions.sql`.
 *
 * One policy: members of the Organization read its rows. No member write
 * policy, deliberately. The one thing that closes a row is an anonymous caller
 * holding a signed URL, applied by the runtime through the system Db, and
 * "the first callback wins" is the whole protection against a Flow's
 * remaining actions running twice. A member update policy would let any
 * Member PATCH a row past that rule through PostgREST. So this file asserts
 * the read policy and the absence of every write policy, as `authenticated`,
 * the role PostgREST asks as; the pglite harness otherwise runs as a superuser
 * and never reaches RLS.
 */

let pg: PGlite;
let orgA: string;
let orgB: string;
/** An Editor of org A. */
let memberA: string;
/** Signed up, a Member of nothing. */
let nobody: string;

const SUB_A = "hook-a";
const SUB_B = "hook-b";

async function seedUser(email: string, orgId: string | null, role = "editor"): Promise<string> {
  const id = randomUUID();
  await pg.query(
    `insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, '{}')`,
    [id, email]
  );
  if (orgId) {
    await pg.query(
      `insert into public.organization_members (organization_id, user_id, role)
       values ($1, $2, $3)
       on conflict (organization_id, user_id) do update set role = excluded.role`,
      [orgId, id, role]
    );
  }
  return id;
}

/** Run one statement the way PostgREST does: as `authenticated`, as this user. */
async function actingAs(
  userId: string,
  sql: string,
  params: unknown[] = []
): Promise<{ rows: unknown[] }> {
  await pg.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId]);
  await pg.exec("set role authenticated");
  try {
    return (await pg.query(sql, params)) as { rows: unknown[] };
  } finally {
    await pg.exec("reset role");
  }
}

async function statusOf(id: string): Promise<string> {
  const result = await pg.query(
    `select status from public.webhook_subscriptions where id = $1`,
    [id]
  );
  return (result.rows[0] as { status: string }).status;
}

beforeAll(async () => {
  pg = await createSchemaLoadedPglite();
  orgA = randomUUID();
  orgB = randomUUID();
  await pg.query(
    `insert into public.organizations (id, name) values ($1, 'Webhook Access A'), ($2, 'Webhook Access B')`,
    [orgA, orgB]
  );
  memberA = await seedUser("member-a@webhook-test.edu", orgA);
  nobody = await seedUser("nobody@webhook-test.edu", null);

  // Supabase grants these to `authenticated` out of band, so the migrations
  // never mention them; without them `set role authenticated` fails on
  // privileges before RLS is ever consulted, and the policies go untested.
  await pg.exec(`
    grant usage on schema public to authenticated;
    grant usage on schema private to authenticated;
    grant select, insert, update, delete
      on all tables in schema public to authenticated;
  `);

  await pg.query(
    `insert into public.assistants (id, organization_id, title)
     values ('asst-a', $1, 'Assistant A'), ('asst-b', $2, 'Assistant B')`,
    [orgA, orgB]
  );
  await pg.query(
    `insert into public.conversations (id, assistant_id, subject_type, subject_id)
     values ('conv-a', 'asst-a', 'visitor', 'visitor-a'),
            ('conv-b', 'asst-b', 'visitor', 'visitor-b')`
  );
  await pg.query(
    `insert into public.webhook_subscriptions
       (id, organization_id, assistant_id, conversation_id, flow_id, action_index,
        subscribe_method, subscribe_url, expires_at)
     values ($1, $2, 'asst-a', 'conv-a', 'flow-a', 1, 'POST',
             'https://orders.example.com/subscribe', now() + interval '15 minutes'),
            ($3, $4, 'asst-b', 'conv-b', 'flow-b', 0, 'POST',
             'https://billing.example.com/subscribe', now() + interval '15 minutes')`,
    [SUB_A, orgA, SUB_B, orgB]
  );
}, 120_000);

afterAll(async () => {
  await pg?.close();
});

describe("reading webhook subscriptions, as PostgREST reaches them", () => {
  it("shows a Member their Organization's subscriptions and none of another's", async () => {
    const result = await actingAs(
      memberA,
      `select id from public.webhook_subscriptions order by id`
    );
    expect(result.rows).toEqual([{ id: SUB_A }]);
  });

  it("shows nothing to a signed-in user who is a Member of nothing", async () => {
    const result = await actingAs(nobody, `select id from public.webhook_subscriptions`);
    expect(result.rows).toEqual([]);
  });
});

describe("writing webhook subscriptions: no member policy, on purpose", () => {
  it("refuses a Member inserting a subscription into their own Organization", async () => {
    await expect(
      actingAs(
        memberA,
        `insert into public.webhook_subscriptions
           (id, organization_id, assistant_id, conversation_id, flow_id, action_index,
            subscribe_method, subscribe_url, expires_at)
         values ('hook-forged', $1, 'asst-a', 'conv-a', 'flow-a', 0, 'POST',
                 'https://orders.example.com/subscribe', now() + interval '15 minutes')`,
        [orgA]
      )
    ).rejects.toThrow(/row-level security/);
  });

  it("refuses a Member closing the gate by PATCHing the row", async () => {
    // With no update policy the row is visible and not writable: the statement
    // matches nothing rather than failing, so the assertion is on the row.
    const updated = await actingAs(
      memberA,
      `update public.webhook_subscriptions
          set status = 'received', payload = '{"forged":true}', received_at = now()
        where id = $1 returning id`,
      [SUB_A]
    );
    expect(updated.rows).toHaveLength(0);
    expect(await statusOf(SUB_A)).toBe("pending");
  });

  it("refuses a Member deleting a subscription", async () => {
    const deleted = await actingAs(
      memberA,
      `delete from public.webhook_subscriptions where id = $1 returning id`,
      [SUB_A]
    );
    expect(deleted.rows).toHaveLength(0);
    expect(await statusOf(SUB_A)).toBe("pending");
  });

  it("still lets the runtime, which bypasses RLS, close the row once", async () => {
    // The service role is what the callback route and the expiry sweep use;
    // in pglite the superuser stands in for it.
    await pg.query(
      `update public.webhook_subscriptions
          set status = 'received', payload = '{"orderId":"A-1"}', received_at = now()
        where id = $1 and status = 'pending'`,
      [SUB_A]
    );
    expect(await statusOf(SUB_A)).toBe("received");
  });
});
