import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createSchemaLoadedPglite } from "./supabase-contract-harness";

/**
 * `20260928120000_model_sources_ai_gateway` replaces three checks by their
 * default constraint names. A wrong name makes `drop constraint if exists` a
 * silent no-op and leaves the old check rejecting every new value, so the
 * values themselves are asserted here against the shipping chain.
 */

let pg: PGlite;
let orgId: string;

beforeAll(async () => {
  pg = await createSchemaLoadedPglite();
  orgId = randomUUID();
  await pg.query(`insert into public.organizations (id, name) values ($1, 'Gateway Org')`, [
    orgId,
  ]);
}, 120_000);

afterAll(async () => {
  await pg?.close();
});

describe("the AI Gateway schema", () => {
  it("stores an Organization's AI Gateway connection", async () => {
    await expect(
      pg.query(
        `insert into public.provider_connections (id, organization_id, provider, type)
         values ($1, $2, 'ai_gateway', 'api_key')`,
        [randomUUID(), orgId]
      )
    ).resolves.toBeTruthy();
  });

  it("records usage on the Organization's Gateway key", async () => {
    await expect(
      pg.query(
        `insert into public.ai_usage
           (organization_id, stage, provider, model_id, input_tokens, output_tokens, credential_kind)
         values ($1, 'generate', 'anthropic', 'claude-sonnet-5', 1, 1, 'ai_gateway')`,
        [orgId]
      )
    ).resolves.toBeTruthy();
    await expect(
      pg.query(
        `insert into public.usage_daily (organization_id, day, kind, credential_kind)
         values ($1, current_date, 'chat', 'ai_gateway')`,
        [orgId]
      )
    ).resolves.toBeTruthy();
  });

  it("still refuses a credential kind nobody defined", async () => {
    await expect(
      pg.query(
        `insert into public.ai_usage
           (organization_id, stage, provider, model_id, input_tokens, output_tokens, credential_kind)
         values ($1, 'generate', 'anthropic', 'claude-sonnet-5', 1, 1, 'carrier_pigeon')`,
        [orgId]
      )
    ).rejects.toThrow(/check constraint/);
  });

  it("pins an Assistant's model source, and only to a known one", async () => {
    await pg.query(
      `insert into public.assistants (id, organization_id, title, model_source)
       values ('as-gw', $1, 'Gateway', 'ai_gateway')`,
      [orgId]
    );
    await expect(
      pg.query(
        `insert into public.assistants (id, organization_id, title, model_source)
         values ('as-bad', $1, 'Bad', 'subscription')`,
        [orgId]
      )
    ).rejects.toThrow(/check constraint/);
  });
});
