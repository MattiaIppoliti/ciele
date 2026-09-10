import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createSchemaLoadedPglite } from "./supabase-contract-harness";

/**
 * Who may read and who may write a Review Request (#841), against the
 * shipping migration `20260908150000_review_requests.sql`.
 *
 * The migration declares exactly one policy: members of the Organization read
 * its rows. There is deliberately no member write policy. Who may close a
 * request, and when, is the decide operation's rule, and it writes through the
 * system Db; a member update policy would let any Member PATCH the row past
 * "first decision wins" through PostgREST. So this file asserts the read
 * policy and then asserts the *absence* of every write policy, as
 * `authenticated`, which is the role PostgREST asks as. The pglite harness
 * otherwise runs as a superuser and never reaches RLS at all.
 */

let pg: PGlite;
let orgA: string;
let orgB: string;
/** An Editor of org A. */
let memberA: string;
/** Signed up, a Member of nothing. */
let nobody: string;

const REVIEW_A = "rev-a";
const REVIEW_B = "rev-b";

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
  const result = await pg.query(`select status from public.review_requests where id = $1`, [id]);
  return (result.rows[0] as { status: string }).status;
}

beforeAll(async () => {
  pg = await createSchemaLoadedPglite();
  orgA = randomUUID();
  orgB = randomUUID();
  await pg.query(
    `insert into public.organizations (id, name) values ($1, 'Review Access A'), ($2, 'Review Access B')`,
    [orgA, orgB]
  );
  memberA = await seedUser("member-a@review-test.edu", orgA);
  nobody = await seedUser("nobody@review-test.edu", null);

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
    `insert into public.review_requests
       (id, organization_id, assistant_id, conversation_id, flow_id, action_index,
        title, channel, assignees, expires_at)
     values ($1, $2, 'asst-a', 'conv-a', 'flow-a', 1, 'Approve the refund', 'email',
             '["member-a@review-test.edu"]'::jsonb, now() + interval '1 day'),
            ($3, $4, 'asst-b', 'conv-b', 'flow-b', 0, 'Approve the discount', 'slack',
             '[]'::jsonb, now() + interval '1 day')`,
    [REVIEW_A, orgA, REVIEW_B, orgB]
  );
}, 120_000);

afterAll(async () => {
  await pg?.close();
});

describe("reading review requests, as PostgREST reaches them", () => {
  it("shows a Member their Organization's requests and none of another's", async () => {
    const result = await actingAs(memberA, `select id from public.review_requests order by id`);
    expect(result.rows).toEqual([{ id: REVIEW_A }]);
  });

  it("shows nothing to a signed-in user who is a Member of nothing", async () => {
    const result = await actingAs(nobody, `select id from public.review_requests`);
    expect(result.rows).toEqual([]);
  });
});

describe("writing review requests: no member policy, on purpose", () => {
  it("refuses a Member inserting a request into their own Organization", async () => {
    await expect(
      actingAs(
        memberA,
        `insert into public.review_requests
           (id, organization_id, assistant_id, conversation_id, flow_id, action_index,
            title, channel, expires_at)
         values ('rev-forged', $1, 'asst-a', 'conv-a', 'flow-a', 0, 'Forged', 'email',
                 now() + interval '1 day')`,
        [orgA]
      )
    ).rejects.toThrow(/row-level security/);
  });

  it("refuses an assignee deciding their own request by PATCHing the row", async () => {
    // With no update policy the row is visible and not writable: the statement
    // matches nothing rather than failing, so the assertion is on the row.
    const updated = await actingAs(
      memberA,
      `update public.review_requests set status = 'approved', decided_by = $1
        where id = $2 returning id`,
      [memberA, REVIEW_A]
    );
    expect(updated.rows).toHaveLength(0);
    expect(await statusOf(REVIEW_A)).toBe("pending");
  });

  it("refuses a Member deleting a request", async () => {
    const deleted = await actingAs(
      memberA,
      `delete from public.review_requests where id = $1 returning id`,
      [REVIEW_A]
    );
    expect(deleted.rows).toHaveLength(0);
    expect(await statusOf(REVIEW_A)).toBe("pending");
  });

  it("still lets the runtime, which bypasses RLS, close the row once", async () => {
    // The service role is what the decide operation and the expiry sweep use;
    // in pglite the superuser stands in for it.
    await pg.query(
      `update public.review_requests set status = 'approved', decided_by = $1, decided_at = now()
        where id = $2 and status = 'pending'`,
      [memberA, REVIEW_A]
    );
    expect(await statusOf(REVIEW_A)).toBe("approved");
  });
});
