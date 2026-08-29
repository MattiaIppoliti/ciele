import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createSchemaLoadedPglite } from "./supabase-contract-harness";

/**
 * Who may change a Teammate channel (#778), against the shipping migration.
 *
 * The operations layer in `packages/ops/src/channels.ts` is the readable half of
 * these rules, and PostgREST is a way around the operations layer: a request
 * carrying a Member's own JWT reaches the tables directly. So the rules that
 * decide who may rename a thread, who may be seated in one and whose seat can
 * move are asserted here, where they actually run.
 *
 * Two mechanisms, because they answer different questions. The manage rule is a
 * trigger: the same row carries `updated_at`, which every member moves by
 * posting, so a policy (which sees a row, not a column) cannot hold both halves.
 * Everything else is RLS, exercised the way PostgREST reaches it, as
 * `authenticated` with the caller's id in the JWT claim rather than as the
 * superuser PGlite otherwise hands us.
 */

let pg: PGlite;
let orgId: string;
/** Opened the channel. Deliberately an Editor, so the creator branch is what passes. */
let creator: string;
/** In the channel, opened nothing. */
let member: string;
/** In the organization, not in the channel. */
let outsider: string;
/** An org Admin who was never invited: oversight without a seat. */
let admin: string;

const CHANNEL = "ch-launch";
const OTHER_CHANNEL = "ch-private";

async function seedUser(email: string, role: string): Promise<string> {
  const id = randomUUID();
  await pg.query(
    `insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, '{}')`,
    [id, email]
  );
  await pg.query(
    `insert into public.organization_members (organization_id, user_id, role)
     values ($1, $2, $3)
     on conflict (organization_id, user_id) do update set role = excluded.role`,
    [orgId, id, role]
  );
  return id;
}

/** Run one statement the way PostgREST does: as `authenticated`, as this user. */
async function actingAs(
  userId: string,
  sql: string,
  params: unknown[] = []
): Promise<{ rows: unknown[] }> {
  await pg.query(`select set_config('request.jwt.claim.sub', $1, false)`, [
    userId,
  ]);
  await pg.exec("set role authenticated");
  try {
    return (await pg.query(sql, params)) as { rows: unknown[] };
  } finally {
    await pg.exec("reset role");
  }
}

/** Same, for the trigger tests, which fire whatever role is asking. */
async function asOwnerOf(userId: string, sql: string, params: unknown[] = []) {
  await pg.query(`select set_config('request.jwt.claim.sub', $1, false)`, [
    userId,
  ]);
  return pg.query(sql, params);
}

beforeAll(async () => {
  pg = await createSchemaLoadedPglite();
  orgId = randomUUID();
  await pg.query(`insert into public.organizations (id, name) values ($1, $2)`, [
    orgId,
    "Channel Access U",
  ]);
  creator = await seedUser("creator@channel-test.edu", "editor");
  member = await seedUser("member@channel-test.edu", "editor");
  outsider = await seedUser("outsider@channel-test.edu", "editor");
  admin = await seedUser("admin@channel-test.edu", "admin");

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
    `insert into public.projects (id, organization_id, name) values ('pr-1', $1, 'Launch plan')`,
    [orgId]
  );
  await pg.query(
    `insert into public.teammate_channels (id, organization_id, name, created_by, project_id)
     values ($1, $2, 'Launch', $3, 'pr-1'), ($4, $2, 'Private', $5, null)`,
    [CHANNEL, orgId, creator, OTHER_CHANNEL, outsider]
  );
  await pg.query(
    `insert into public.teammate_channel_participants (id, organization_id, channel_id, user_id)
     values ('seat-creator', $1, $2, $3),
            ('seat-member', $1, $2, $4),
            ('seat-outsider', $1, $5, $6)`,
    [orgId, CHANNEL, creator, member, OTHER_CHANNEL, outsider]
  );
  await pg.query(
    `insert into public.teammates (id, organization_id, name, owner_id, visibility)
     values ('tm-open', $1, 'Scheduler', $2, 'org'),
            ('tm-secret', $1, 'Confidant', $3, 'private')`,
    [orgId, creator, outsider]
  );
}, 120_000);

afterAll(async () => {
  await pg?.close();
});

describe("the channel manage rule (#778)", () => {
  it("lets whoever opened the channel rename it", async () => {
    await expect(
      asOwnerOf(creator, `update public.teammate_channels set name = $1 where id = $2`, [
        "Launch, renamed",
        CHANNEL,
      ])
    ).resolves.toBeTruthy();
  });

  it("lets an org admin who was never invited rename it", async () => {
    await expect(
      asOwnerOf(admin, `update public.teammate_channels set name = $1 where id = $2`, [
        "Launch, by an admin",
        CHANNEL,
      ])
    ).resolves.toBeTruthy();
  });

  it("refuses a rename by a member who is only in the channel", async () => {
    await expect(
      asOwnerOf(member, `update public.teammate_channels set name = $1 where id = $2`, [
        "Hijacked",
        CHANNEL,
      ])
    ).rejects.toThrow(/Only whoever opened this channel/);
  });

  it("refuses unbinding the Project from the same member", async () => {
    await expect(
      asOwnerOf(
        member,
        `update public.teammate_channels set project_id = null where id = $1`,
        [CHANNEL]
      )
    ).rejects.toThrow(/Only whoever opened this channel/);
  });

  it("still lets that member move updated_at, which posting does", async () => {
    await expect(
      asOwnerOf(
        member,
        `update public.teammate_channels set updated_at = now() where id = $1`,
        [CHANNEL]
      )
    ).resolves.toBeTruthy();
  });

  it("refuses handing the channel to somebody else", async () => {
    await expect(
      asOwnerOf(
        member,
        `update public.teammate_channels set created_by = $1 where id = $2`,
        [member, CHANNEL]
      )
    ).rejects.toThrow(/Only whoever opened this channel/);
  });
});

describe("the channel roster, as PostgREST reaches it", () => {
  it("refuses to move a seat into a channel the member is not in", async () => {
    const moved = await actingAs(
      member,
      `update public.teammate_channel_participants
         set channel_id = $1 where id = 'seat-member' returning id`,
      [OTHER_CHANNEL]
    ).catch((error: Error) => error);
    // Either the policy refuses the write outright or it matches no row; what
    // must not happen is a seat in a thread nobody invited them to.
    if (!(moved instanceof Error)) expect(moved.rows).toHaveLength(0);
    const seats = await pg.query(
      `select channel_id from public.teammate_channel_participants where id = 'seat-member'`
    );
    expect((seats.rows[0] as { channel_id: string }).channel_id).toBe(CHANNEL);
  });

  it("lets a member move their own read marker", async () => {
    const marked = await actingAs(
      member,
      `update public.teammate_channel_participants
         set last_read_at = now() where id = 'seat-member' returning id`
    );
    expect(marked.rows).toHaveLength(1);
  });

  it("seats an org-visible Teammate", async () => {
    const seated = await actingAs(
      member,
      `insert into public.teammate_channel_participants
         (id, organization_id, channel_id, teammate_id)
       values ('seat-open', $1, $2, 'tm-open') returning id`,
      [orgId, CHANNEL]
    );
    expect(seated.rows).toHaveLength(1);
  });

  it("refuses to seat somebody else's private Teammate", async () => {
    await expect(
      actingAs(
        member,
        `insert into public.teammate_channel_participants
           (id, organization_id, channel_id, teammate_id)
         values ('seat-secret', $1, $2, 'tm-secret')`,
        [orgId, CHANNEL]
      )
    ).rejects.toThrow(/row-level security/);
  });

  it("lets a member leave, and refuses removing a colleague", async () => {
    await pg.query(
      `insert into public.teammate_channel_participants
         (id, organization_id, channel_id, user_id)
       values ('seat-guest', $1, $2, $3)`,
      [orgId, CHANNEL, admin]
    );
    const removedSomebodyElse = await actingAs(
      member,
      `delete from public.teammate_channel_participants
        where id = 'seat-guest' returning id`
    );
    expect(removedSomebodyElse.rows).toHaveLength(0);

    const left = await actingAs(
      member,
      `delete from public.teammate_channel_participants
        where id = 'seat-member' returning id`
    );
    expect(left.rows).toHaveLength(1);
  });
});
