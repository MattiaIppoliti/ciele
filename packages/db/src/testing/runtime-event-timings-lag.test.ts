import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { Db } from "../types";
import { createSupabaseDb } from "../supabase";
import { createPgliteSupabaseClient } from "./postgrest-shim";
import { createSchemaLoadedPglite } from "./supabase-contract-harness";

/**
 * The deploy serves against a database one migration behind (see
 * `schema-lag.test.ts`). The turn clock (#1112) puts `timings` on every
 * `chat_turn`, so before `runtime_events.timings` exists PostgREST refuses the
 * whole row; the adapter has to write the event without it, or every turn's
 * telemetry is lost for the window.
 */

let pg: PGlite;
let db: Db;
let organizationId: string;

beforeAll(async () => {
  pg = await createSchemaLoadedPglite({
    stopBefore: "20261021120000_runtime_event_timings.sql",
  });
  const userId = randomUUID();
  await pg.query(
    `insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, '{}')`,
    [userId, "owner@timings-lag.edu"]
  );
  await pg.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId]);
  db = createSupabaseDb(
    createPgliteSupabaseClient(pg, { id: userId, email: "owner@timings-lag.edu" })
  );
  organizationId = await db.createOrganization("Timings Lag Org");
}, 120_000);

afterAll(async () => {
  await pg?.close();
});

describe("against a schema without runtime_events.timings", () => {
  it("records the chat_turn without its timings instead of losing it", async () => {
    await expect(
      db.recordRuntimeEvent({
        organizationId,
        assistantId: null,
        kind: "chat_turn",
        status: "succeeded",
        durationMs: 1234,
        timings: {
          firstTokenMs: 10,
          queueMs: 0,
          modelMs: 0,
          modelMsByStage: {},
          modelCallTimings: [],
          embedMs: 0,
          rerankMs: 0,
          decideMs: 0,
          dbMs: 5,
          retrievalMs: 0,
          toolMs: 0,
          tools: {},
          toolCallTimings: [],
          waitMs: 5,
          modelCalls: 0,
          cpuMs: 1,
          overlap: 1,
          jobsInFlight: 0,
          trigger: "live",
        },
      })
    ).resolves.toBeUndefined();
    const { rows } = await pg.query<{ kind: string; duration_ms: number }>(
      `select kind, duration_ms from public.runtime_events where organization_id = $1`,
      [organizationId]
    );
    expect(rows).toEqual([{ kind: "chat_turn", duration_ms: 1234 }]);
  });
});
