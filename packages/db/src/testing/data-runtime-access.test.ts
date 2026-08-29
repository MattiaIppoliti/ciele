import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createSchemaLoadedPglite } from "./supabase-contract-harness";

let pg: PGlite;
let organizationId: string;
let foreignOrganizationId: string;
let editorId: string;

async function actingAs(sql: string, params: unknown[] = []) {
  await pg.query(`select set_config('request.jwt.claim.sub', $1, false)`, [editorId]);
  await pg.exec("set role authenticated");
  try {
    return await pg.query(sql, params);
  } finally {
    await pg.exec("reset role");
  }
}

beforeAll(async () => {
  pg = await createSchemaLoadedPglite();
  organizationId = randomUUID();
  foreignOrganizationId = randomUUID();
  editorId = randomUUID();
  await pg.query(
    `insert into public.organizations (id, name) values ($1, 'Runtime'), ($2, 'Foreign')`,
    [organizationId, foreignOrganizationId]
  );
  await pg.query(
    `insert into auth.users (id, email, raw_user_meta_data) values ($1, 'runtime@test.dev', '{}')`,
    [editorId]
  );
  await pg.query(
    `insert into public.organization_members (organization_id, user_id, role)
     values ($1, $2, 'editor')`,
    [organizationId, editorId]
  );
  await pg.exec(`
    grant usage on schema public, private to authenticated;
    grant select, insert, update, delete on all tables in schema public to authenticated;
  `);
  await pg.query(
    `insert into public.assistants (id, organization_id, title)
     values ('runtime-assistant', $1, 'Runtime'), ('foreign-runtime-assistant', $2, 'Foreign')`,
    [organizationId, foreignOrganizationId]
  );
  await pg.query(
    `insert into public.knowledge_collections (id, organization_id, name)
     values ('runtime-library', $1, 'Runtime'), ('foreign-runtime-library', $2, 'Foreign')`,
    [organizationId, foreignOrganizationId]
  );
  await pg.exec(`
    insert into public.sources (id, collection_id, name, kind)
    values ('runtime-source', 'runtime-library', 'Runtime', 'text'),
           ('foreign-runtime-source', 'foreign-runtime-library', 'Foreign', 'text');
    insert into public.assistant_sources (assistant_id, source_id)
    values ('runtime-assistant', 'runtime-source'),
           ('foreign-runtime-assistant', 'foreign-runtime-source');
    insert into public.conversations (id, assistant_id, subject_type, subject_id)
    values ('runtime-conversation', 'runtime-assistant', 'member', '${editorId}'),
           ('foreign-runtime-conversation', 'foreign-runtime-assistant', 'member', 'foreign');
    insert into public.messages (id, conversation_id, role, content)
    values ('runtime-message', 'runtime-conversation', 'assistant', '[]'),
           ('foreign-runtime-message', 'foreign-runtime-conversation', 'assistant', '[]');
  `);
  await pg.query(
    `insert into public.background_jobs
       (id, organization_id, kind, status, payload, next_run_at)
     values ('runtime-job', $1, 'ingest_source', 'queued', '{}', now()),
            ('foreign-runtime-job', $2, 'ingest_source', 'queued', '{}', now())`,
    [organizationId, foreignOrganizationId]
  );
  await pg.query(
    `insert into public.conversation_turns
       (conversation_id, request_id, status, lease_token, locked_by, locked_at)
     values ('runtime-conversation', 'runtime-request', 'running', gen_random_uuid(), 'worker', now()),
            ('foreign-runtime-conversation', 'foreign-request', 'running', gen_random_uuid(), 'worker', now())`
  );
  await pg.query(
    `insert into public.turn_effect_outbox
       (organization_id, conversation_id, message_id, effect_index, payload)
     values ($1, 'runtime-conversation', 'runtime-message', 0, '{"kind":"create_improvement"}'),
            ($2, 'foreign-runtime-conversation', 'foreign-runtime-message', 0, '{"kind":"create_improvement"}')`,
    [organizationId, foreignOrganizationId]
  );
  await pg.query(
    `insert into public.source_ingest_payloads (source_id, version, raw_text)
     values ('runtime-source', 1, 'runtime'), ('foreign-runtime-source', 1, 'foreign')`
  );
}, 120_000);

afterAll(async () => pg?.close());

const workerFunctions = [
  "public.claim_conversation_turn(text,text,text,timestamp with time zone,timestamp with time zone)",
  "public.complete_conversation_turn(text,text,uuid,text,timestamp with time zone)",
  "public.fail_conversation_turn(text,text,uuid,text,timestamp with time zone)",
  "public.commit_conversation_turn(text,text,text,uuid,jsonb,text,text,jsonb,jsonb,timestamp with time zone)",
  "public.claim_background_jobs(text,text,timestamp with time zone,timestamp with time zone,integer)",
  "public.claim_terminal_background_jobs(text,text,timestamp with time zone,timestamp with time zone,integer)",
  "public.claim_active_graph_datasets(integer)",
  "public.settle_background_job(text,uuid,timestamp with time zone,text,text,timestamp with time zone)",
  "public.renew_background_job_lease(text,uuid,timestamp with time zone)",
  "public.claim_turn_effects(text,text,timestamp with time zone,timestamp with time zone,integer)",
  "public.settle_turn_effect(uuid,uuid,timestamp with time zone,boolean,text)",
  "public.reserve_org_budget(uuid,bigint,numeric,numeric,timestamp with time zone,timestamp with time zone)",
  "public.settle_org_budget_reservation(uuid,jsonb)",
  "public.release_org_budget_reservation(uuid)",
  "public.get_work_queue_health(timestamp with time zone)",
  "public.claim_api_idempotency(text,text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone)",
  "public.complete_api_idempotency(text,text,uuid,integer,text,text,timestamp with time zone)",
  "public.release_api_idempotency(text,text,uuid)",
  "public.create_application_sync_job_if_absent(text,text,uuid,timestamp with time zone,integer)",
  "public.settle_application_sync_job_success(text,uuid,text,uuid,text,timestamp with time zone,integer)",
  "public.initialize_source_ingest_attempt(text,uuid,text,bigint,jsonb)",
  "public.checkpoint_source_ingest_cursor(text,uuid,text,bigint,uuid,integer)",
  "public.upgrade_legacy_source_ingest_job(text,uuid,text,text,text,text,timestamp with time zone)",
  "public.commit_source_ingest_generation(text,uuid,text,bigint,uuid,uuid)",
  "public.list_memory_subjects_page(uuid,timestamp with time zone,text,integer)",
  "public.sweep_runtime_ledgers(timestamp with time zone,integer)",
] as const;

describe("data-runtime database access", () => {
  it("keeps worker RPCs service-role-only", async () => {
    for (const signature of workerFunctions) {
      const { rows } = await pg.query<{ authenticated: boolean; service: boolean }>(
        `select
           has_function_privilege('authenticated', $1, 'EXECUTE') as authenticated,
           has_function_privilege('service_role', $1, 'EXECUTE') as service`,
        [signature]
      );
      expect(rows[0], signature).toEqual({ authenticated: false, service: true });
    }
  });

  it("enables RLS on every new public runtime table", async () => {
    const names = [
      "api_idempotency_keys",
      "background_jobs",
      "conversation_turns",
      "org_budget_reservations",
      "source_ingest_payloads",
      "turn_effect_outbox",
    ];
    const { rows } = await pg.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity
       from pg_class
       where relnamespace = 'public'::regnamespace and relname = any($1::text[])
       order by relname`,
      [names]
    );
    expect(rows).toHaveLength(names.length);
    expect(rows.every((row) => row.relrowsecurity)).toBe(true);
  });

  it("shows authenticated Members only their Organization runtime rows", async () => {
    for (const [table, idColumn] of [
      ["background_jobs", "id"],
      ["conversation_turns", "conversation_id"],
      ["turn_effect_outbox", "message_id"],
      ["source_ingest_payloads", "source_id"],
    ] as const) {
      const { rows } = await actingAs(
        `select ${idColumn} as id from public.${table} order by ${idColumn}`
      );
      expect(rows, table).toHaveLength(1);
      expect(String((rows[0] as { id: string }).id), table).not.toContain("foreign");
    }
  });

  it("lets Editors enqueue owned work but rejects foreign rows and assistant effects", async () => {
    await expect(
      actingAs(
        `insert into public.background_jobs
           (id, organization_id, kind, status, payload, next_run_at)
         values ('editor-job', $1, 'ingest_source', 'queued', '{}', now())`,
        [organizationId]
      )
    ).resolves.toBeTruthy();
    await expect(
      actingAs(
        `insert into public.background_jobs
           (id, organization_id, kind, status, payload, next_run_at)
         values ('foreign-editor-job', $1, 'ingest_source', 'queued', '{}', now())`,
        [foreignOrganizationId]
      )
    ).rejects.toThrow(/row-level security/i);
    await expect(
      actingAs(
        `insert into public.source_ingest_payloads (source_id, version, raw_text)
         values ('runtime-source', 2, 'owned')`
      )
    ).resolves.toBeTruthy();
    await expect(
      actingAs(
        `insert into public.source_ingest_payloads (source_id, version, raw_text)
         values ('foreign-runtime-source', 2, 'foreign')`
      )
    ).rejects.toThrow(/row-level security/i);
    await expect(
      actingAs(
        `insert into public.messages
           (id, conversation_id, role, content, deferred_effects)
         values ('forged-assistant', 'runtime-conversation', 'assistant', '[]',
                 '[{"kind":"create_improvement","title":"forged"}]')`
      )
    ).rejects.toThrow(/row-level security/i);
  });

  it("lets an Editor atomically supersede an older Source ingest", async () => {
    const stage = () =>
      actingAs(
        `select public.stage_source_ingest_job(
           $1, 'runtime-source', 'runtime-assistant', 'runtime-library', $2, now()
         ) as version`,
        [randomUUID(), `revision-${randomUUID()}`]
      );

    await stage();
    await stage();

    const { rows } = await pg.query<{ status: string; error: string | null }>(
      `select status, error from public.background_jobs
       where source_id = 'runtime-source' and kind = 'ingest_source'
       order by created_at, id`
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.status)).toEqual(["failed", "queued"]);
    expect(rows[0]?.error).toMatch(/superseded/i);
  });

  it("upgrades only the newest durable pre-versioning Source revision", async () => {
    const oldLease = randomUUID();
    const newLease = randomUUID();
    await pg.query(
      `insert into public.background_jobs
         (id, organization_id, kind, source_id, status, payload, next_run_at,
          created_at, updated_at, locked_at, locked_by, lease_token)
       values
         ('legacy-old', $1, 'ingest_source', 'runtime-source', 'running',
          '{"kind":"ingest_source","rawText":"revision one"}', now(),
          now() + interval '1 minute', now(), now(), 'worker-old', $2),
         ('legacy-new', $1, 'ingest_source', 'runtime-source', 'running',
          '{"kind":"ingest_source","rawText":"revision two"}', now(),
          now() + interval '2 minutes', now(), now(), 'worker-new', $3)`,
      [organizationId, oldLease, newLease]
    );

    await pg.query(`select set_config('request.jwt.claim.role', 'service_role', false)`);
    await pg.exec("set role service_role");
    try {
      const oldResult = await pg.query<{ version: number | null }>(
        `select public.upgrade_legacy_source_ingest_job(
           'legacy-old', $1, 'runtime-assistant', 'runtime-library',
           'runtime-source', 'revision one', now()
         ) as version`,
        [oldLease]
      );
      expect(oldResult.rows[0]?.version).toBeNull();
      const newResult = await pg.query<{ version: number | null }>(
        `select public.upgrade_legacy_source_ingest_job(
           'legacy-new', $1, 'runtime-assistant', 'runtime-library',
           'runtime-source', 'revision two', now()
         ) as version`,
        [newLease]
      );
      expect(newResult.rows[0]?.version).toBeTypeOf("number");
    } finally {
      await pg.exec("reset role");
      await pg.query(`select set_config('request.jwt.claim.role', '', false)`);
    }

    const { rows } = await pg.query<{
      id: string;
      status: string;
      raw_text: string | null;
    }>(
      `select j.id, j.status, sip.raw_text
       from public.background_jobs j
       left join public.source_ingest_payloads sip
         on sip.source_id = j.source_id
        and sip.version = (j.payload ->> 'payloadVersion')::bigint
       where j.id in ('legacy-old', 'legacy-new')
       order by j.id`
    );
    expect(rows).toEqual([
      { id: "legacy-new", status: "running", raw_text: "revision two" },
      { id: "legacy-old", status: "failed", raw_text: null },
    ]);
  });

  it("rejects an older revision after the newest revision is already converted", async () => {
    const oldLease = randomUUID();
    const newLease = randomUUID();
    await pg.exec(`
      insert into public.sources (id, collection_id, name, kind)
      values ('runtime-source-reverse', 'runtime-library', 'Reverse', 'text');
      insert into public.assistant_sources (assistant_id, source_id)
      values ('runtime-assistant', 'runtime-source-reverse');
    `);
    await pg.query(
      `insert into public.background_jobs
         (id, organization_id, kind, source_id, status, payload, next_run_at,
          created_at, updated_at, locked_at, locked_by, lease_token)
       values
         ('legacy-reverse-old', $1, 'ingest_source', 'runtime-source-reverse', 'running',
          '{"kind":"ingest_source","rawText":"revision one"}', now(),
          '2026-08-28T11:00:00Z', now(), now(), 'worker-old', $2),
         ('legacy-reverse-new', $1, 'ingest_source', 'runtime-source-reverse', 'running',
          '{"kind":"ingest_source","rawText":"revision two"}', now(),
          '2026-08-28T11:01:00Z', now(), now(), 'worker-new', $3)`,
      [organizationId, oldLease, newLease]
    );

    await pg.query(`select set_config('request.jwt.claim.role', 'service_role', false)`);
    await pg.exec("set role service_role");
    try {
      const newResult = await pg.query<{ version: number | null }>(
        `select public.upgrade_legacy_source_ingest_job(
           'legacy-reverse-new', $1, 'runtime-assistant', 'runtime-library',
           'runtime-source-reverse', 'revision two', now()
         ) as version`,
        [newLease]
      );
      expect(newResult.rows[0]?.version).toBeTypeOf("number");

      await pg.exec("reset role");
      await pg.query(
        `update public.background_jobs
         set status = 'succeeded', locked_at = null, locked_by = null, lease_token = null
         where id = 'legacy-reverse-new'`
      );
      await pg.query(
        `update public.background_jobs
         set status = 'running', locked_at = now(), locked_by = 'worker-old', lease_token = $1
         where id = 'legacy-reverse-old'`,
        [oldLease]
      );
      await pg.exec("set role service_role");
      const oldResult = await pg.query<{ version: number | null }>(
        `select public.upgrade_legacy_source_ingest_job(
           'legacy-reverse-old', $1, 'runtime-assistant', 'runtime-library',
           'runtime-source-reverse', 'revision one', now()
         ) as version`,
        [oldLease]
      );
      expect(oldResult.rows[0]?.version).toBeNull();
    } finally {
      await pg.exec("reset role");
      await pg.query(`select set_config('request.jwt.claim.role', '', false)`);
    }

    const { rows } = await pg.query<{ raw_text: string }>(
      `select raw_text from public.source_ingest_payloads
       where source_id = 'runtime-source-reverse' order by version`
    );
    expect(rows).toEqual([{ raw_text: "revision two" }]);
  });
});
