import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { createSupabaseDb } from "../supabase";
import type { DbContractContext } from "../db-contract.suite";
import { createPgliteSupabaseClient } from "./postgrest-shim";

/**
 * PGlite-backed context for `describeDbContract("supabase", …)`, ADR-0016
 * stage 2. Boots an in-process Postgres, applies the REAL migrations, and
 * hands the REAL `createSupabaseDb` a PostgREST shim, so mock↔Supabase drift
 * is finally asserted against one spec with no Docker and no live project.
 */

const MIGRATIONS_DIR = fileURLToPath(
  new URL("../../../../supabase/migrations", import.meta.url)
);

/*
 * There used to be a FRESH_DB_SKIP set here: the chain carried 0017–0020 AND
 * their byte-identical backfill twins 0025–0028, so a fresh database could
 * not apply both members of a pair and this harness kept whichever applied
 * cleanly. That was this file's private workaround for a defect the whole
 * chain had. The chain is fixed at the source now — 0025–0028 are documented
 * no-ops and 0018 guards its join_demo_org grants — and the migrations CI
 * gate replays the full chain on an empty Postgres. The harness applies the
 * chain exactly as shipped, which is the point of a contract harness.
 */

/** Supabase-managed surface the migrations reference but do not create. */
const PREAMBLE = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key,
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
-- Mirrors GoTrue's auth.uid(): the caller identity, read from a session GUC.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'authenticated')
$$;
create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  metadata jsonb
);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[]
language sql immutable as $$
  select (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1]
$$;
`;

export interface SchemaLoadedPgliteOptions {
  /**
   * Absolute paths to migration directories applied *after* the open-source
   * chain, in the order given, the same phase ordering
   * `scripts/apply-migrations.sh` uses for `ee/migrations`. A caller outside
   * the open-source tree passes its own chain here so this harness never has
   * to know that chain exists (the dependency direction stays one-way).
   */
  extraMigrationDirs?: readonly string[];
  /**
   * Stop the chain just before this filename (exclusive). For upgrade-path
   * tests that seed legacy-shaped rows and then replay the remaining
   * migrations themselves, the only way to exercise a data migration whose
   * later contract step drops the columns the seed needs.
   */
  stopBefore?: string;
}

/** Boot PGlite and apply the full production schema. */
export async function createSchemaLoadedPglite(
  opts: SchemaLoadedPgliteOptions = {}
): Promise<PGlite> {
  const pg = new PGlite({ extensions: { vector, pg_trgm } });
  await pg.exec("set timezone = 'UTC';");
  await pg.exec(PREAMBLE);
  for (const dir of [MIGRATIONS_DIR, ...(opts.extraMigrationDirs ?? [])]) {
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const file of files) {
      if (opts.stopBefore && file >= opts.stopBefore) continue;
      try {
        await pg.exec(readFileSync(join(dir, file), "utf8"));
      } catch (err) {
        throw new Error(
          `supabase-contract-harness: migration ${file} failed: ${(err as Error).message}`,
          { cause: err }
        );
      }
    }
  }
  return pg;
}

async function signUpUser(pg: PGlite, email: string): Promise<string> {
  const id = randomUUID();
  // The real signup triggers run here: consumer-domain rejection (0022) and
  // handle_new_user's profile mirror (0003/0036).
  await pg.query(
    `insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, '{}')`,
    [id, email]
  );
  return id;
}

async function actAs(pg: PGlite, userId: string): Promise<void> {
  await pg.query(`select set_config('request.jwt.claim.sub', $1, false)`, [
    userId,
  ]);
}

/**
 * Context factory for the contract suite: one owner user + their org, plus a
 * foreign org owned by a different user (seeded for real, so referential
 * integrity and scoping are exercised against actual rows).
 */
export async function createSupabaseContractContext(): Promise<DbContractContext> {
  const pg = await createSchemaLoadedPglite();

  const foreignUserId = await signUpUser(pg, "foreign-owner@contract-test.edu");
  await actAs(pg, foreignUserId);
  const foreignDb = createSupabaseDb(
    createPgliteSupabaseClient(pg, {
      id: foreignUserId,
      email: "foreign-owner@contract-test.edu",
    })
  );
  const foreignOrganizationId = await foreignDb.createOrganization("Foreign Org");
  const foreignAssistant = await foreignDb.createAssistant(foreignOrganizationId, {
    title: "Foreign Contract Assistant",
  });

  const userId = await signUpUser(pg, "owner@contract-test.edu");
  await actAs(pg, userId);
  const db = createSupabaseDb(
    createPgliteSupabaseClient(pg, {
      id: userId,
      email: "owner@contract-test.edu",
    })
  );
  const systemDb = createSupabaseDb(
    createPgliteSupabaseClient(
      pg,
      { id: userId, email: "owner@contract-test.edu" },
      "service_role"
    )
  );
  const organizationName = "Contract Org";
  const organizationId = await db.createOrganization(organizationName);

  return {
    db,
    systemDb,
    organizationId,
    organizationName,
    userId,
    missingOrganizationId: randomUUID(),
    foreignOrganizationId,
    foreignAssistantId: foreignAssistant.id,
    teardown: () => pg.close(),
  };
}
