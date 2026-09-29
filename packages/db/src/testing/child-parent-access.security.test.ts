import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createSchemaLoadedPglite } from "./supabase-contract-harness";

/**
 * Child rows may not name a parent in another Organization, a Teammate's 1:1
 * chat is private to its Member, ai_usage cannot go negative, and three
 * SECURITY DEFINER functions are the service role's alone
 * (`20260929120000` .. `20260929120200`).
 *
 * The contract suite connects as a superuser and never reaches RLS, so every
 * assertion here asks as `authenticated` with the caller's id in the JWT claim,
 * which is how PostgREST reaches these tables with a Member's own token.
 */

const MIGRATIONS = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../supabase/migrations"
);

const GRANT_LIKE_SUPABASE = `
  grant usage on schema public to anon, authenticated;
  grant usage on schema private to anon, authenticated;
  grant select, insert, update, delete
    on all tables in schema public to authenticated;
`;

let pg: PGlite;
let orgA: string;
let orgB: string;
let editorA: string;
let colleagueA: string;
let adminA: string;

async function seedUser(email: string, org: string, role: string): Promise<string> {
  const id = randomUUID();
  await pg.query(
    `insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, '{}')`,
    [id, email]
  );
  await pg.query(
    `insert into public.organization_members (organization_id, user_id, role)
     values ($1, $2, $3)
     on conflict (organization_id, user_id) do update set role = excluded.role`,
    [org, id, role]
  );
  return id;
}

async function actingAs<Row = unknown>(
  userId: string,
  sql: string,
  params: unknown[] = []
): Promise<{ rows: Row[] }> {
  await pg.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId]);
  await pg.exec("set role authenticated");
  try {
    return (await pg.query<Row>(sql, params)) as { rows: Row[] };
  } finally {
    await pg.exec("reset role");
  }
}

const RLS = /row-level security/;

beforeAll(async () => {
  pg = await createSchemaLoadedPglite();
  orgA = randomUUID();
  orgB = randomUUID();
  await pg.query(`insert into public.organizations (id, name) values ($1, 'A'), ($2, 'B')`, [
    orgA,
    orgB,
  ]);
  editorA = await seedUser("editor@cpa-test.edu", orgA, "editor");
  colleagueA = await seedUser("colleague@cpa-test.edu", orgA, "editor");
  adminA = await seedUser("admin@cpa-test.edu", orgA, "admin");
  await pg.exec(GRANT_LIKE_SUPABASE);

  await pg.query(
    `insert into public.assistants (id, organization_id, title)
     values ('as-a', $1, 'Mine'), ('as-b', $2, 'Victim')`,
    [orgA, orgB]
  );
  await pg.query(
    `insert into public.teammates (id, organization_id, name, owner_id, visibility)
     values ('tm-a', $1, 'Mine', $3, 'org'), ('tm-b', $2, 'Victim', null, 'org')`,
    [orgA, orgB, editorA]
  );
  await pg.query(
    `insert into public.knowledge_collections (id, organization_id, name)
     values ('kc-a', $1, 'A'), ('kc-b', $2, 'B')`,
    [orgA, orgB]
  );
  await pg.exec(`
    insert into public.sources (id, collection_id, name, kind)
    values ('src-a', 'kc-a', 'A', 'text'), ('src-b', 'kc-b', 'B', 'text');
    insert into public.concepts (id, collection_id, source_id, path)
    values ('con-a', 'kc-a', 'src-a', 'a.md'), ('con-a2', 'kc-a', null, 'a2.md');
  `);
});

afterAll(async () => {
  await pg?.close();
});

describe("assistant_api_integrations and assistant_goals name only their own assistants", () => {
  const integration = (assistantId: string) =>
    `insert into public.assistant_api_integrations
       (assistant_id, organization_id, base_url) values ('${assistantId}', '${orgA}', 'https://evil.example')`;

  it("refuses an integration planted on another org's assistant", async () => {
    await expect(actingAs(editorA, integration("as-b"))).rejects.toThrow(RLS);
  });

  it("still lets an editor write one for their own assistant", async () => {
    await actingAs(editorA, integration("as-a"));
    const { rows } = await actingAs(editorA, `select 1 from public.assistant_api_integrations`);
    expect(rows).toHaveLength(1);
  });

  it("refuses repointing an existing integration at a foreign assistant", async () => {
    await expect(
      actingAs(
        editorA,
        `update public.assistant_api_integrations set assistant_id = 'as-b' where assistant_id = 'as-a'`
      )
    ).rejects.toThrow(RLS);
  });

  it("holds even for the service role, through the composite key", async () => {
    await expect(pg.query(integration("as-b"))).rejects.toThrow(/foreign key/);
  });

  const goal = (id: string, assistantId: string) =>
    `insert into public.assistant_goals (id, organization_id, assistant_id, question)
     values ('${id}', '${orgA}', '${assistantId}', 'q?')`;

  it("refuses a goal on another org's assistant, and repointing one", async () => {
    await expect(actingAs(editorA, goal("g-bad", "as-b"))).rejects.toThrow(RLS);
    await actingAs(editorA, goal("g-ok", "as-a"));
    await expect(
      actingAs(editorA, `update public.assistant_goals set assistant_id = 'as-b' where id = 'g-ok'`)
    ).rejects.toThrow(RLS);
  });
});

describe("concepts and concept_chunks stay inside one Organization", () => {
  it("refuses a Concept whose Source lives in another org", async () => {
    await expect(
      actingAs(
        editorA,
        `insert into public.concepts (id, collection_id, source_id, path)
         values ('con-bad', 'kc-a', 'src-b', 'x.md')`
      )
    ).rejects.toThrow(RLS);
    await actingAs(
      editorA,
      `insert into public.concepts (id, collection_id, source_id, path)
       values ('con-ok', 'kc-a', 'src-a', 'ok.md')`
    );
  });

  it("refuses repointing a Concept at a foreign Source", async () => {
    await expect(
      actingAs(editorA, `update public.concepts set source_id = 'src-b' where id = 'con-a'`)
    ).rejects.toThrow(RLS);
  });

  it("refuses a chunk with a foreign Source", async () => {
    await expect(
      actingAs(
        editorA,
        `insert into public.concept_chunks (id, concept_id, collection_id, source_id, content)
         values ('ch-bad', 'con-a2', 'kc-a', 'src-b', 'planted')`
      )
    ).rejects.toThrow(RLS);
  });

  it("refuses a chunk that disagrees with its Concept", async () => {
    await expect(
      actingAs(
        editorA,
        `insert into public.concept_chunks (id, concept_id, collection_id, source_id, content)
         values ('ch-mismatch', 'con-a2', 'kc-a', 'src-a', 'wrong source for this concept')`
      )
    ).rejects.toThrow(RLS);
  });

  it("accepts a chunk that agrees with its Concept", async () => {
    await actingAs(
      editorA,
      `insert into public.concept_chunks (id, concept_id, collection_id, source_id, content)
       values ('ch-ok', 'con-a', 'kc-a', 'src-a', 'fine')`
    );
    await expect(
      actingAs(
        editorA,
        `update public.concept_chunks set source_id = 'src-b' where id = 'ch-ok'`
      )
    ).rejects.toThrow(RLS);
  });
});

describe("teammate_grants and teammate_routines name only their own Teammate", () => {
  it("refuses a grant on another org's Teammate, allows one on its own", async () => {
    await expect(
      actingAs(
        adminA,
        `insert into public.teammate_grants (id, organization_id, teammate_id, domain)
         values ('gr-bad', '${orgA}', 'tm-b', 'inbox')`
      )
    ).rejects.toThrow(RLS);
    await actingAs(
      adminA,
      `insert into public.teammate_grants (id, organization_id, teammate_id, domain)
       values ('gr-ok', '${orgA}', 'tm-a', 'inbox')`
    );
    await expect(
      actingAs(adminA, `update public.teammate_grants set teammate_id = 'tm-b' where id = 'gr-ok'`)
    ).rejects.toThrow(RLS);
  });

  it("refuses a routine on another org's Teammate", async () => {
    await expect(
      actingAs(
        editorA,
        `insert into public.teammate_routines (id, organization_id, teammate_id, instruction, cadence)
         values ('rt-bad', '${orgA}', 'tm-b', 'do it', 'daily')`
      )
    ).rejects.toThrow(RLS);
    await actingAs(
      editorA,
      `insert into public.teammate_routines (id, organization_id, teammate_id, instruction, cadence)
       values ('rt-ok', '${orgA}', 'tm-a', 'do it', 'daily')`
    );
  });
});

describe("a Teammate chat is private to its Member", () => {
  beforeAll(async () => {
    await pg.query(
      `insert into public.conversations (id, teammate_id, subject_type, subject_id)
       values ('tc-1', 'tm-a', 'member', $1)`,
      [editorA]
    );
    await pg.query(
      `insert into public.messages (id, conversation_id, role, content)
       values ('tmsg-1', 'tc-1', 'user', '[{"type":"text","text":"private"}]')`
    );
    await pg.query(
      `insert into public.conversations (id, assistant_id, subject_type, subject_id)
       values ('ac-1', 'as-a', 'visitor', 'v-1')`
    );
    await pg.query(
      `insert into public.messages (id, conversation_id, role, content)
       values ('amsg-1', 'ac-1', 'user', '[]')`
    );
  });

  it("shows the owner their own thread and messages", async () => {
    const convs = await actingAs(editorA, `select id from public.conversations where id = 'tc-1'`);
    const msgs = await actingAs(editorA, `select id from public.messages where id = 'tmsg-1'`);
    expect(convs.rows).toHaveLength(1);
    expect(msgs.rows).toHaveLength(1);
  });

  it("shows a colleague zero rows of it, even an admin", async () => {
    for (const other of [colleagueA, adminA]) {
      expect(
        (await actingAs(other, `select id from public.conversations where id = 'tc-1'`)).rows
      ).toHaveLength(0);
      expect(
        (await actingAs(other, `select id from public.messages where id = 'tmsg-1'`)).rows
      ).toHaveLength(0);
    }
  });

  it("refuses a colleague writing into it or opening one in its name", async () => {
    await expect(
      actingAs(
        colleagueA,
        `insert into public.messages (id, conversation_id, role, content)
         values ('tmsg-bad', 'tc-1', 'user', '[]')`
      )
    ).rejects.toThrow(RLS);
    await expect(
      actingAs(
        colleagueA,
        `insert into public.conversations (id, teammate_id, subject_type, subject_id)
         values ('tc-forged', 'tm-a', 'member', '${editorA}')`
      )
    ).rejects.toThrow(RLS);
  });

  it("lets a colleague open their own thread with the same Teammate", async () => {
    await actingAs(
      colleagueA,
      `insert into public.conversations (id, teammate_id, subject_type, subject_id)
       values ('tc-2', 'tm-a', 'member', '${colleagueA}')`
    );
    await actingAs(
      colleagueA,
      `insert into public.messages (id, conversation_id, role, content)
       values ('tmsg-2', 'tc-2', 'user', '[]')`
    );
  });

  it("leaves Assistant conversations readable by every org member", async () => {
    for (const member of [editorA, colleagueA]) {
      expect(
        (await actingAs(member, `select id from public.messages where id = 'amsg-1'`)).rows
      ).toHaveLength(1);
    }
  });

  it("does not show a Teammate thread of another org to anyone", async () => {
    const outsider = await seedUser("outsider@cpa-test.edu", orgB, "editor");
    expect(
      (await actingAs(outsider, `select id from public.conversations where id = 'tc-1'`)).rows
    ).toHaveLength(0);
  });
});

describe("ai_usage", () => {
  const usage = (input: number, output: number) =>
    `insert into public.ai_usage (organization_id, stage, provider, model_id, input_tokens, output_tokens)
     values ('${orgA}', 'generate', 'anthropic', 'm', ${input}, ${output})`;

  it("refuses negative token counts from a Member", async () => {
    await expect(actingAs(editorA, usage(-1000000, 0))).rejects.toThrow(/ai_usage_tokens_nonnegative/);
    await expect(actingAs(editorA, usage(0, -1))).rejects.toThrow(/ai_usage_tokens_nonnegative/);
  });

  it("still records a normal turn", async () => {
    await actingAs(editorA, usage(120, 40));
  });
});

describe("application sync functions are the service role's alone", () => {
  let pgBefore: PGlite;
  const calls = [
    `select public.acquire_application_import_sync('x', gen_random_uuid())`,
    `select public.reserve_application_knowledge_bytes('x', gen_random_uuid(), 1, 10)`,
    `select public.cancel_application_sync_jobs('x', 'r')`,
  ];

  async function asRole(db: PGlite, role: "anon" | "authenticated", sql: string) {
    await db.exec(`set role ${role}`);
    try {
      return await db.query(sql);
    } finally {
      await db.exec("reset role");
    }
  }

  beforeAll(async () => {
    // Supabase grants EXECUTE on every new function to anon and authenticated
    // out of band. Stop just before the revoking migration, grant the same,
    // then apply it: the before/after pair is what shows the revoke bites.
    pgBefore = await createSchemaLoadedPglite({
      stopBefore: "20260929120200_ai_usage_nonnegative_and_rpc_revokes.sql",
    });
    await pgBefore.exec(`
      ${GRANT_LIKE_SUPABASE}
      grant execute on all functions in schema public to anon, authenticated;
    `);
  }, 120_000);

  afterAll(async () => {
    await pgBefore?.close();
  });

  it("are reachable by anon and authenticated before the migration", async () => {
    for (const sql of calls) {
      await expect(asRole(pgBefore, "anon", sql)).resolves.toBeTruthy();
      await expect(asRole(pgBefore, "authenticated", sql)).resolves.toBeTruthy();
    }
  });

  it("are refused to both once the migration has run, and kept for service_role", async () => {
    await pgBefore.exec(
      readFileSync(
        join(MIGRATIONS, "20260929120200_ai_usage_nonnegative_and_rpc_revokes.sql"),
        "utf8"
      )
    );
    for (const sql of calls) {
      await expect(asRole(pgBefore, "anon", sql)).rejects.toThrow(/permission denied/);
      await expect(asRole(pgBefore, "authenticated", sql)).rejects.toThrow(/permission denied/);
    }
    const { rows } = await pgBefore.query<{ ok: boolean }>(
      `select has_function_privilege('service_role',
         'public.acquire_application_import_sync(text, uuid)', 'execute') as ok`
    );
    expect(rows[0]?.ok).toBe(true);
  });
});
