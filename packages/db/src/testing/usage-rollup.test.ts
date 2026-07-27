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

/**
 * The window read (#506). Plan windows run from a Stripe billing anchor, so they
 * start and end at arbitrary times of day — never on a UTC midnight. Reading a
 * day-grained rollup for such a window would silently count whole days that the
 * window only partly covers, which is exactly the error that makes a cap fire
 * early or late. Only real SQL with backdated rows can exercise that boundary.
 */
describe("org_usage_meters — arbitrary windows (real SQL)", () => {
  let orgId: string;

  /** Same UTC day as `backdate`, at an explicit hour. */
  const backdateAt = (daysAgo: number, hour: number): string => {
    const d = new Date();
    d.setUTCHours(hour, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - daysAgo);
    return d.toISOString();
  };

  const metersOf = async (
    from: string,
    to: string
  ): Promise<Map<string, { tokens: number; units: number }>> => {
    const res = await pg.query<{
      resource: string;
      input_tokens: string | number;
      output_tokens: string | number;
      units: string | number;
    }>("select * from public.org_usage_meters($1, $2, $3)", [orgId, from, to]);
    const out = new Map<string, { tokens: number; units: number }>();
    for (const r of res.rows) {
      const at = out.get(r.resource) ?? { tokens: 0, units: 0 };
      at.tokens += Number(r.input_tokens) + Number(r.output_tokens);
      at.units += Number(r.units);
      out.set(r.resource, at);
    }
    return out;
  };

  beforeAll(async () => {
    const res = await pg.query<{ id: string }>(
      "insert into public.organizations (name) values ('Window Org') returning id"
    );
    orgId = res.rows[0].id;
    // One model call three days ago at noon…
    await pg.query(
      `insert into public.ai_usage
         (organization_id, assistant_id, stage, provider, model_id, credential_kind,
          input_tokens, output_tokens, created_at)
       values ($1, null, 'generate', 'google', 'gemini-3.5-flash', 'platform', 500, 0, $2)`,
      [orgId, backdateAt(3, 12)]
    );
    // …and one completed crawl the same day.
    await pg.query(
      `insert into public.runtime_events
         (organization_id, kind, status, crawler_provider, page_count, created_at)
       values ($1, 'crawl', 'succeeded', 'apify', 40, $2)`,
      [orgId, backdateAt(3, 12)]
    );
    await pg.query("select public.rollup_usage_daily($1)", [6]);
  }, 120_000);

  it("serves a closed day inside the window from the rollup", async () => {
    const meters = await metersOf(backdateAt(4, 0), new Date().toISOString());
    expect(meters.get("ai")?.tokens).toBe(500);
    expect(meters.get("scraping")?.units).toBe(40);
  });

  it("excludes a partial day before the window start, though the rollup closed it", async () => {
    // Window opens six hours AFTER the usage — the whole day is in the rollup,
    // but none of it belongs to this window.
    const meters = await metersOf(backdateAt(3, 18), new Date().toISOString());
    expect(meters.get("ai")?.tokens ?? 0).toBe(0);
    expect(meters.get("scraping")?.units ?? 0).toBe(0);
  });

  it("includes a partial day when the usage falls inside the window", async () => {
    const meters = await metersOf(backdateAt(3, 6), new Date().toISOString());
    expect(meters.get("ai")?.tokens).toBe(500);
    expect(meters.get("scraping")?.units).toBe(40);
  });

  it("excludes a partial day after the window end", async () => {
    const meters = await metersOf(backdateAt(4, 0), backdateAt(3, 6));
    expect(meters.get("ai")?.tokens ?? 0).toBe(0);
  });

  it("counts the boundary instant itself as inside the window", async () => {
    // [from, to): from is inclusive, to is exclusive.
    const inclusive = await metersOf(backdateAt(3, 12), new Date().toISOString());
    expect(inclusive.get("ai")?.tokens).toBe(500);
    const exclusive = await metersOf(backdateAt(4, 0), backdateAt(3, 12));
    expect(exclusive.get("ai")?.tokens ?? 0).toBe(0);
  });

  it("does not double-count a day the rollup has closed", async () => {
    const before = await metersOf(backdateAt(4, 0), new Date().toISOString());
    await pg.query("select public.rollup_usage_daily($1)", [6]);
    await pg.query("select public.rollup_usage_daily($1)", [6]);
    const after = await metersOf(backdateAt(4, 0), new Date().toISOString());
    expect(after).toEqual(before);
  });

  it("keeps today live alongside a closed day, without overlap", async () => {
    await pg.query(
      `insert into public.ai_usage
         (organization_id, assistant_id, stage, provider, model_id, credential_kind,
          input_tokens, output_tokens)
       values ($1, null, 'generate', 'google', 'gemini-3.5-flash', 'platform', 7, 3)`,
      [orgId]
    );
    // The rollup has seen today too; the window read must still count it once.
    await pg.query("select public.rollup_usage_daily($1)", [6]);
    const meters = await metersOf(backdateAt(4, 0), new Date().toISOString());
    expect(meters.get("ai")?.tokens).toBe(510);
  });
});

/**
 * The window read's day arithmetic must be pinned to UTC, not to whatever
 * `TimeZone` the session happens to carry. `date_trunc('day', ts)` on a
 * timestamptz truncates in the session zone, which shifts the boundary between
 * "take this from the rollup" and "read this live" by the zone's offset — and a
 * shifted boundary means the two ranges overlap and the same usage is counted
 * twice. usage_daily.day is a UTC date, so UTC is the only correct frame.
 */
describe("org_usage_meters — UTC pinning (real SQL)", () => {
  let orgId: string;

  // Early morning UTC: inside the offset window where a session-zone truncation
  // would put this row in BOTH the live head range and the closed rollup day.
  const earlyOnDay = (daysAgo: number, hour: number): string => {
    const d = new Date();
    d.setUTCHours(hour, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - daysAgo);
    return d.toISOString();
  };

  const aiTokens = async (from: string, to: string): Promise<number> => {
    const res = await pg.query<{
      resource: string;
      input_tokens: string | number;
      output_tokens: string | number;
    }>("select * from public.org_usage_meters($1, $2, $3)", [orgId, from, to]);
    return res.rows
      .filter((r) => r.resource === "ai")
      .reduce((sum, r) => sum + Number(r.input_tokens) + Number(r.output_tokens), 0);
  };

  beforeAll(async () => {
    const res = await pg.query<{ id: string }>(
      "insert into public.organizations (name) values ('UTC Org') returning id"
    );
    orgId = res.rows[0].id;
    await pg.query(
      `insert into public.ai_usage
         (organization_id, assistant_id, stage, provider, model_id, credential_kind,
          input_tokens, output_tokens, created_at)
       values ($1, null, 'generate', 'google', 'gemini-3.5-flash', 'platform', 1000, 0, $2)`,
      [orgId, earlyOnDay(4, 2)]
    );
    await pg.query("select public.rollup_usage_daily($1)", [8]);
  }, 120_000);

  it("counts early-morning usage once, in any session timezone", async () => {
    const window: [string, string] = [
      earlyOnDay(4, 0),
      new Date().toISOString(),
    ];
    expect(await aiTokens(...window)).toBe(1000);
    for (const zone of ["America/New_York", "Asia/Tokyo", "Etc/GMT-1"]) {
      await pg.query(`set time zone '${zone}'`);
      try {
        expect(await aiTokens(...window)).toBe(1000);
      } finally {
        await pg.query("set time zone 'UTC'");
      }
    }
  });
});
