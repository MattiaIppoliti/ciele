import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { createSupabaseDb } from "../supabase";
import type { DbContractContext } from "../db-contract.suite";
import { createPgliteSupabaseClient } from "./postgrest-shim";

/**
 * PGlite-backed context for `describeDbContract("supabase", …)` — ADR-0016
 * stage 2. Boots an in-process Postgres, applies the REAL migrations, and
 * hands the REAL `createSupabaseDb` a PostgREST shim, so mock↔Supabase drift
 * is finally asserted against one spec with no Docker and no live project.
 */

const MIGRATIONS_DIR = fileURLToPath(
  new URL("../../../../supabase/migrations", import.meta.url)
);

/**
 * The live project's history applied 0017–0020 out-of-band and later gained
 * "backfill" twins (0023–0028) so fresh environments could be rebuilt; both
 * members of each pair are baseline files that CI records without executing
 * (see supabase/migrations-baseline.txt). On a truly fresh database, applying
 * BOTH members of a pair fails (duplicate objects), and 0018 additionally
 * depends on `join_demo_org` which only 0023 creates. The fresh-database
 * equivalent set keeps whichever member applies cleanly in filename order and
 * skips its verbatim twin.
 */
const FRESH_DB_SKIP = new Set([
  "0018_private_schema_hardening.sql", // twin: 0026 (applies after 0023's join_demo_org)
  "0025_backfill_query_performance_hardening.sql", // twin: 0017_query_performance_hardening
  "0027_backfill_system_prompts.sql", // twin: 0019_system_prompts
  "0028_backfill_member_profile_fk.sql", // twin: 0020_member_profile_fk
]);

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

/** Boot PGlite and apply the full production schema. */
export async function createSchemaLoadedPglite(): Promise<PGlite> {
  const pg = new PGlite({ extensions: { vector } });
  await pg.exec("set timezone = 'UTC';");
  await pg.exec(PREAMBLE);
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    if (FRESH_DB_SKIP.has(file)) continue;
    try {
      await pg.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    } catch (err) {
      throw new Error(
        `supabase-contract-harness: migration ${file} failed: ${(err as Error).message}`,
        { cause: err }
      );
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

  const userId = await signUpUser(pg, "owner@contract-test.edu");
  await actAs(pg, userId);
  const db = createSupabaseDb(
    createPgliteSupabaseClient(pg, {
      id: userId,
      email: "owner@contract-test.edu",
    })
  );
  const organizationName = "Contract Org";
  const organizationId = await db.createOrganization(organizationName);

  return {
    db,
    organizationId,
    organizationName,
    userId,
    missingOrganizationId: randomUUID(),
    foreignOrganizationId,
    // Seeds a real editor-role member (auth user + membership row) so
    // member-scoped cases run against actual referential integrity.
    seedOrgMember: async () => {
      const memberId = await signUpUser(
        pg,
        `member-${randomUUID().slice(0, 8)}@contract-test.edu`
      );
      await pg.query(
        `insert into public.organization_members (organization_id, user_id, role)
         values ($1, $2, 'editor')`,
        [organizationId, memberId]
      );
      return memberId;
    },
    teardown: () => pg.close(),
  };
}
