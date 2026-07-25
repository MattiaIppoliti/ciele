import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { createSchemaLoadedPglite } from "./supabase-contract-harness";

/**
 * Closed-day coverage for the usage rollup (#438). The shared Db contract can
 * only ever record rows at `now()`, so it exercises today-live reads and
 * rollup idempotency but never the rollup's core job: *closing* a prior day so
 * `org_usage_daily` serves it from the cheap `usage_daily` aggregate instead
 * of the raw ledger. Backdating a ledger row needs raw SQL, so this drives the
 * real migration functions on PGlite directly.
 */

let pg: PGlite;
let organizationId: string;

// Backdated so it lands in a *closed* prior day (not today's live range).
const backdate = (daysAgo: number): string => {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString();
};

async function insertUsage(row: {
  createdAt: string;
  stage: string;
  credentialKind: string | null;
  inputTokens: number;
  outputTokens: number;
}): Promise<void> {
  await pg.query(
    `insert into public.ai_usage
       (organization_id, assistant_id, stage, provider, model_id, credential_kind, input_tokens, output_tokens, created_at)
     values ($1, null, $2, 'anthropic', 'claude-haiku-4-5', $3, $4, $5, $6)`,
    [
      organizationId,
      row.stage,
      row.credentialKind,
      row.inputTokens,
      row.outputTokens,
      row.createdAt,
    ]
  );
}

beforeAll(async () => {
  pg = await createSchemaLoadedPglite();
  const res = await pg.query<{ id: string }>(
    "insert into public.organizations (name) values ('Rollup Org') returning id"
  );
  organizationId = res.rows[0].id;
}, 120_000);

afterAll(async () => {
  await pg?.close();
});

describe("usage_daily rollup — closed days (real SQL)", () => {
  it("closes a prior day into usage_daily and serves it from the report", async () => {
    await insertUsage({
      createdAt: backdate(2),
      stage: "generate",
      credentialKind: "platform",
      inputTokens: 300,
      outputTokens: 40,
    });
    await insertUsage({
      createdAt: backdate(2),
      stage: "embed",
      credentialKind: "api_key",
      inputTokens: 60,
      outputTokens: 0,
    });

    // Before the rollup runs, no usage_daily row exists for that closed day…
    const preRollup = await pg.query(
      "select count(*)::int as n from public.usage_daily where organization_id = $1",
      [organizationId]
    );
    expect((preRollup.rows[0] as { n: number }).n).toBe(0);

    // A wide window so the two-day-ago rows are recomputed.
    const upserted = await pg.query<{ n: number }>(
      "select public.rollup_usage_daily($1) as n",
      [5]
    );
    expect(Number(upserted.rows[0].n)).toBeGreaterThanOrEqual(2);

    const report = await pg.query<{
      day: string;
      kind: string;
      credential_kind: string;
      calls: string | number;
      input_tokens: string | number;
      output_tokens: string | number;
    }>("select * from public.org_usage_daily($1, $2)", [organizationId, 30]);

    const day = backdate(2).slice(0, 10);
    // PGlite hands a `date` column back as a JS Date; normalize to YYYY-MM-DD.
    const dayOf = (v: unknown) => new Date(v as string).toISOString().slice(0, 10);
    const chat = report.rows.find(
      (r) => dayOf(r.day) === day && r.kind === "chat"
    );
    const embedding = report.rows.find(
      (r) => dayOf(r.day) === day && r.kind === "embedding"
    );
    expect(chat).toMatchObject({
      credential_kind: "platform",
      calls: 1,
      input_tokens: 300,
      output_tokens: 40,
    });
    expect(embedding).toMatchObject({
      credential_kind: "api_key",
      calls: 1,
      input_tokens: 60,
      output_tokens: 0,
    });
  });

  it("recompute is idempotent — a second rollup does not double a closed day", async () => {
    const day = backdate(2).slice(0, 10);
    const readClosed = async () => {
      const res = await pg.query<{ calls: number; input_tokens: number }>(
        `select calls, input_tokens from public.usage_daily
         where organization_id = $1 and day = $2 and kind = 'chat'`,
        [organizationId, day]
      );
      return res.rows[0];
    };
    const first = await readClosed();
    await pg.query("select public.rollup_usage_daily($1)", [5]);
    const second = await readClosed();
    expect(second).toEqual(first);
  });

  it("a late event on a closed day is picked up on the next rollup", async () => {
    const day = backdate(2).slice(0, 10);
    await insertUsage({
      createdAt: backdate(2),
      stage: "classify",
      credentialKind: "platform",
      inputTokens: 100,
      outputTokens: 10,
    });
    await pg.query("select public.rollup_usage_daily($1)", [5]);
    const res = await pg.query<{ calls: number; input_tokens: number }>(
      `select calls, input_tokens from public.usage_daily
       where organization_id = $1 and day = $2 and kind = 'chat'`,
      [organizationId, day]
    );
    // The full-day recompute now reflects both the original and the late row.
    expect(res.rows[0]).toMatchObject({ calls: 2, input_tokens: 400 });
  });
});
