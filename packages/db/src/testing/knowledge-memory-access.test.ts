import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createSchemaLoadedPglite } from "./supabase-contract-harness";

/**
 * Who may read and who may forget a knowledge memory (#926), against the
 * shipping migration.
 *
 * `packages/ops/src/knowledge.ts` is the readable half of these rules, and
 * PostgREST is a way around the operations layer: a request carrying a
 * Member's own JWT reaches the table directly. So the rules are asserted here,
 * as `authenticated` with the caller's id in the JWT claim, rather than as the
 * superuser PGlite otherwise hands us, which walks straight past every policy.
 *
 * The rule itself: every Member of the Organization reads, an Editor writes.
 * Forgetting is an editorial act on the Organization's knowledge, so it sits
 * at the rank that edits a Document, not above it.
 */

let pg: PGlite;
let orgId: string;
let otherOrgId: string;
/** Reads, must not be able to forget. */
let viewer: string;
/** Forgets and restores. */
let editor: string;
/** A Member of a different Organization: sees nothing at all. */
let stranger: string;

const MEMORY = "km-leave";

async function seedUser(
  email: string,
  role: string,
  organizationId: string
): Promise<string> {
  const id = randomUUID();
  await pg.query(
    `insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, '{}')`,
    [id, email]
  );
  await pg.query(
    `insert into public.organization_members (organization_id, user_id, role)
     values ($1, $2, $3)`,
    [organizationId, id, role]
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

beforeAll(async () => {
  pg = await createSchemaLoadedPglite();
  orgId = randomUUID();
  otherOrgId = randomUUID();
  await pg.query(
    `insert into public.organizations (id, name) values ($1, 'Memory U'), ($2, 'Rival U')`,
    [orgId, otherOrgId]
  );
  viewer = await seedUser("viewer@memory-test.edu", "viewer", orgId);
  editor = await seedUser("editor@memory-test.edu", "editor", orgId);
  stranger = await seedUser("stranger@memory-test.edu", "owner", otherOrgId);

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
    `insert into public.knowledge_collections (id, organization_id, name)
     values ('kc-1', $1, 'Handbook')`,
    [orgId]
  );
  await pg.query(
    `insert into public.sources (id, collection_id, name, kind)
     values ('src-1', 'kc-1', 'Handbook', 'text')`
  );
  await pg.query(
    `insert into public.knowledge_memories
       (id, organization_id, collection_id, source_id, document_path, text, quote, generated_by)
     values ($1, $2, 'kc-1', 'src-1', 'handbook/leave.md',
             'Unused leave expires on 31 March.',
             'Unused leave expires on 31 March.',
             'process:knowledge-memory-extraction')`,
    [MEMORY, orgId]
  );
});

describe("knowledge memory access", () => {
  it("lets a Viewer read the Organization's memories", async () => {
    const read = await actingAs(
      viewer,
      `select id from public.knowledge_memories where id = $1`,
      [MEMORY]
    );
    expect(read.rows).toHaveLength(1);
  });

  it("refuses a Viewer the forget, which is an editorial act", async () => {
    await actingAs(
      viewer,
      `update public.knowledge_memories set forgotten_at = now() where id = $1`,
      [MEMORY]
    );
    // RLS filters rather than raising: the update matches no row it may write.
    const after = await pg.query(
      `select forgotten_at from public.knowledge_memories where id = $1`,
      [MEMORY]
    );
    expect((after.rows[0] as { forgotten_at: string | null }).forgotten_at).toBeNull();
  });

  it("lets an Editor forget and then restore", async () => {
    await actingAs(
      editor,
      `update public.knowledge_memories
       set forgotten_at = now(), forget_reason = 'Superseded', forgotten_by = $2
       where id = $1`,
      [MEMORY, editor]
    );
    const forgotten = await pg.query(
      `select forgotten_at, forget_reason from public.knowledge_memories where id = $1`,
      [MEMORY]
    );
    const row = forgotten.rows[0] as {
      forgotten_at: string | null;
      forget_reason: string | null;
    };
    expect(row.forgotten_at).not.toBeNull();
    expect(row.forget_reason).toBe("Superseded");

    await actingAs(
      editor,
      `update public.knowledge_memories
       set forgotten_at = null, forget_reason = null, forgotten_by = null
       where id = $1`,
      [MEMORY]
    );
    const restored = await pg.query(
      `select forgotten_at from public.knowledge_memories where id = $1`,
      [MEMORY]
    );
    expect(
      (restored.rows[0] as { forgotten_at: string | null }).forgotten_at
    ).toBeNull();
  });

  it("shows another Organization's Member nothing", async () => {
    const read = await actingAs(
      stranger,
      `select id from public.knowledge_memories`
    );
    expect(read.rows).toHaveLength(0);
  });

  it("detaches a memory from the Document row a re-crawl deletes", async () => {
    await pg.query(
      `insert into public.concepts (id, collection_id, source_id, path, frontmatter, body)
       values ('con-1', 'kc-1', 'src-1', 'handbook/leave.md', '{}', 'body')`
    );
    await pg.query(
      `update public.knowledge_memories set concept_id = 'con-1' where id = $1`,
      [MEMORY]
    );
    await pg.query(`delete from public.concepts where id = 'con-1'`);
    const after = await pg.query(
      `select concept_id from public.knowledge_memories where id = $1`,
      [MEMORY]
    );
    expect(after.rows).toHaveLength(1);
    expect(
      (after.rows[0] as { concept_id: string | null }).concept_id
    ).toBeNull();
  });
});
