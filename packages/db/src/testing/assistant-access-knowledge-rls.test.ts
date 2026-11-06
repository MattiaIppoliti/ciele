import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createSchemaLoadedPglite } from "./supabase-contract-harness";

/**
 * Per-assistant access on the knowledge tables (PRD #296 / #300,
 * 20260819180000_assistant_access_knowledge.sql).
 *
 * Same shape as assistant-access-rls.test.ts: the harness runs as the PGlite
 * superuser, which bypasses RLS, so every case drops to `authenticated` with a
 * JWT subject. What is asserted here is the rule the migration states:
 *
 *   read  a Source: one visible linked Assistant is enough.
 *   write a Source: every linked Assistant must be writable.
 *   unlink: rights on that one Assistant, never on the others.
 *
 * plus the invariant that matters most in practice: a deployment with no
 * override rows behaves exactly as it did when the org role was the only gate.
 */

const ORG = randomUUID();
const A1 = "know-rls-a1";
const A2 = "know-rls-a2";
const COLLECTION = "know-rls-col";
const SHARED_SOURCE = "know-rls-src-shared";
const OWN_SOURCE = "know-rls-src-own";
const CONCEPT = "know-rls-concept";
const CHUNK = "know-rls-chunk";

const EDITOR = randomUUID(); // org editor, no overrides: the "before" behavior
const SPLIT = randomUUID(); // org editor, denied on A2 only
const SHUT_OUT = randomUUID(); // org editor, denied on both
const RAISED = randomUUID(); // org viewer, editor override on A1

describe("per-assistant access on knowledge (supabase)", () => {
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

  /** RLS filters reads, so visibility is a count, never an error. */
  const countSources = async (id: string) => {
    const res = await pg.query<{ n: number }>(
      `select count(*)::int as n from public.sources where id = $1`,
      [id]
    );
    return res.rows[0].n;
  };
  const countConcepts = async () => {
    const res = await pg.query<{ n: number }>(
      `select count(*)::int as n from public.concepts where id = $1`,
      [CONCEPT]
    );
    return res.rows[0].n;
  };
  const countChunks = async () => {
    const res = await pg.query<{ n: number }>(
      `select count(*)::int as n from public.concept_chunks where id = $1`,
      [CHUNK]
    );
    return res.rows[0].n;
  };
  /** A write that RLS refuses raises; one it allows changes zero or more rows. */
  const rename = (id: string) =>
    pg.query(`update public.sources set name = 'renamed' where id = $1`, [id]);
  const remove = (id: string) =>
    pg.query(`delete from public.sources where id = $1`, [id]);

  beforeAll(async () => {
    pg = await createSchemaLoadedPglite();

    await pg.exec(`
      grant usage on schema public to authenticated;
      grant select, insert, update, delete on all tables in schema public to authenticated;
      grant usage, select on all sequences in schema public to authenticated;
    `);

    for (const [id, email] of [
      [EDITOR, "editor@know-rls.test"],
      [SPLIT, "split@know-rls.test"],
      [SHUT_OUT, "shutout@know-rls.test"],
      [RAISED, "raised@know-rls.test"],
    ] as const) {
      await pg.query(
        `insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, '{}')`,
        [id, email]
      );
    }

    await pg.query(
      `insert into public.organizations (id, name) values ($1, 'Knowledge RLS Org')`,
      [ORG]
    );
    for (const [user, role] of [
      [EDITOR, "editor"],
      [SPLIT, "editor"],
      [SHUT_OUT, "editor"],
      [RAISED, "viewer"],
    ] as const) {
      await pg.query(
        `insert into public.organization_members (organization_id, user_id, role) values ($1, $2, $3)`,
        [ORG, user, role]
      );
    }

    for (const [id, title] of [
      [A1, "Front desk"],
      [A2, "Back office"],
    ] as const) {
      await pg.query(
        `insert into public.assistants (id, title, organization_id) values ($1, $2, $3)`,
        [id, title, ORG]
      );
    }
    for (const [user, assistant, role] of [
      [SPLIT, A2, "denied"],
      [SHUT_OUT, A1, "denied"],
      [SHUT_OUT, A2, "denied"],
      [RAISED, A1, "editor"],
    ] as const) {
      await pg.query(
        `insert into public.assistant_access (assistant_id, user_id, role) values ($1, $2, $3)`,
        [assistant, user, role]
      );
    }

    await pg.query(
      `insert into public.knowledge_collections (id, name, organization_id) values ($1, 'Library', $2)`,
      [COLLECTION, ORG]
    );
    await pg.query(
      `insert into public.sources (id, collection_id, name, kind, status) values
         ($1, $3, 'Shared handbook', 'file', 'ready'),
         ($2, $3, 'Front desk only', 'file', 'ready')`,
      [SHARED_SOURCE, OWN_SOURCE, COLLECTION]
    );
    // The shared Source answers for both Assistants; the other for A1 alone.
    await pg.query(
      `insert into public.assistant_sources (assistant_id, source_id) values
         ($1, $3), ($2, $3), ($1, $4)`,
      [A1, A2, SHARED_SOURCE, OWN_SOURCE]
    );
    await pg.query(
      `insert into public.concepts (id, collection_id, source_id, path, body)
       values ($1, $2, $3, 'docs/handbook.md', 'Body')`,
      [CONCEPT, COLLECTION, SHARED_SOURCE]
    );
    await pg.query(
      `insert into public.concept_chunks (id, concept_id, collection_id, source_id, content)
       values ($1, $2, $3, $4, 'Chunk body')`,
      [CHUNK, CONCEPT, COLLECTION, SHARED_SOURCE]
    );
  }, 120_000);

  afterAll(async () => {
    await pg?.close();
  });

  it("an editor with no overrides keeps the pre-#300 reach", async () => {
    await asUser(EDITOR);
    expect(await countSources(SHARED_SOURCE)).toBe(1);
    expect(await countConcepts()).toBe(1);
    expect(await countChunks()).toBe(1);
    await expect(rename(SHARED_SOURCE)).resolves.toBeTruthy();
  });

  it("a member denied on every linked assistant cannot see the Source at all", async () => {
    await asUser(SHUT_OUT);
    expect(await countSources(SHARED_SOURCE)).toBe(0);
    expect(await countSources(OWN_SOURCE)).toBe(0);
    expect(await countConcepts()).toBe(0);
    expect(await countChunks()).toBe(0);
    // A delete that matches no visible row is a no-op, not an error: RLS
    // filters USING before the write, so nothing is destroyed either way.
    const res = await remove(SHARED_SOURCE);
    expect(res.affectedRows ?? 0).toBe(0);
    await asSuperuserRole();
    expect((await pg.query(`select 1 from public.sources where id = $1`, [
      SHARED_SOURCE,
    ])).rows).toHaveLength(1);
  });

  it("editor on one linked assistant may read but not rewrite a shared Source", async () => {
    await asUser(SPLIT);
    // Visible: A1 carries the read.
    expect(await countSources(SHARED_SOURCE)).toBe(1);
    expect(await countConcepts()).toBe(1);
    // Not writable: A2 is denied, and renaming or deleting changes what A2
    // answers with.
    const renamed = await rename(SHARED_SOURCE);
    expect(renamed.affectedRows ?? 0).toBe(0);
    const removed = await remove(SHARED_SOURCE);
    expect(removed.affectedRows ?? 0).toBe(0);
    // The Source it does not share is fully writable.
    const own = await rename(OWN_SOURCE);
    expect(own.affectedRows ?? 0).toBe(1);
  });

  it("that same member can still unlink the shared Source from their own assistant", async () => {
    await asUser(SPLIT);
    const unlinked = await pg.query(
      `delete from public.assistant_sources where assistant_id = $1 and source_id = $2`,
      [A1, SHARED_SOURCE]
    );
    expect(unlinked.affectedRows ?? 0).toBe(1);
    // The other assistant's link is untouched, and out of reach.
    const other = await pg.query(
      `delete from public.assistant_sources where assistant_id = $1 and source_id = $2`,
      [A2, SHARED_SOURCE]
    );
    expect(other.affectedRows ?? 0).toBe(0);

    await asSuperuserRole();
    const links = await pg.query<{ assistant_id: string }>(
      `select assistant_id from public.assistant_sources where source_id = $1`,
      [SHARED_SOURCE]
    );
    expect(links.rows.map((r) => r.assistant_id)).toEqual([A2]);
    // Restore for the cases below.
    await pg.query(
      `insert into public.assistant_sources (assistant_id, source_id) values ($1, $2)`,
      [A1, SHARED_SOURCE]
    );
  });

  it("an org viewer raised to editor on one assistant may add knowledge", async () => {
    await asUser(RAISED);
    // The org role alone would refuse this; the override on A1 carries it.
    await expect(
      pg.query(
        `insert into public.sources (id, collection_id, name, kind, status)
         values ('know-rls-src-new', $1, 'Added by override', 'file', 'ready')`,
        [COLLECTION]
      )
    ).resolves.toBeTruthy();
    // And linking it to the assistant they were raised on.
    await expect(
      pg.query(
        `insert into public.assistant_sources (assistant_id, source_id)
         values ($1, 'know-rls-src-new')`,
        [A1]
      )
    ).resolves.toBeTruthy();
    // But not to the one they were not.
    await expect(
      pg.query(
        `insert into public.assistant_sources (assistant_id, source_id)
         values ($1, 'know-rls-src-new')`,
        [A2]
      )
    ).rejects.toThrow(/row-level security/);
  });

  it("an unlinked Source stays reachable to the Organization's editors", async () => {
    await asSuperuserRole();
    await pg.query(
      `insert into public.sources (id, collection_id, name, kind, status)
       values ('know-rls-src-orphan', $1, 'Nobody linked', 'file', 'ready')`,
      [COLLECTION]
    );
    // No links: the fallback is the Organization, which is what keeps the
    // window between createSource and the first link workable.
    await asUser(EDITOR);
    expect(await countSources("know-rls-src-orphan")).toBe(1);
    const renamed = await rename("know-rls-src-orphan");
    expect(renamed.affectedRows ?? 0).toBe(1);
    // Even the member denied on both assistants: the Source answers for
    // neither of them, so there is no per-assistant rule left to apply.
    await asUser(SHUT_OUT);
    expect(await countSources("know-rls-src-orphan")).toBe(1);
  });
});
