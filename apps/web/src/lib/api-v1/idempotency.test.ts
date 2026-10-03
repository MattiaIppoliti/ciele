import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMockDb, type Db } from "@agent-hub/db";
import { clearIdempotencyStore, withIdempotency } from "./idempotency";

let db: Db;
vi.mock("@/lib/api-v1/db", () => ({ getApiV1Db: () => db }));

const request = () => new Request("https://test/api/v1/assistants?secret=private-query", {
  method: "POST", headers: {
    "x-vercel-id": "iad1::request-a", authorization: "Bearer private-token", "idempotency-key": "private-key",
  }, body: "private body",
});

beforeEach(() => {
  db = getMockDb();
  clearIdempotencyStore();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

function expectSafeFailure(event: string) {
  const errors = vi.mocked(console.error).mock.calls;
  expect(errors).toHaveLength(1);
  expect(JSON.parse(errors[0]![0])).toMatchObject({ event, requestId: "iad1::request-a", errorClass: "Error", route: "/api/v1" });
  expect(JSON.stringify(errors)).not.toContain("private");
}

describe("caught idempotency failures", () => {
  it("reports a claim outage and keeps the mutation unexecuted", async () => {
    db = { ...db, claimApiIdempotency: async () => { throw new Error("private db credential"); } };
    const execute = vi.fn();
    const response = await withIdempotency(request(), "private-scope", execute);
    expect(response.status).toBe(503);
    expect(execute).not.toHaveBeenCalled();
    expectSafeFailure("api.idempotency.claim");
  });

  it("reports an execution failure once and replays its existing 500 envelope", async () => {
    const execute = vi.fn(async () => { throw new Error("private model payload"); });
    const first = await withIdempotency(request(), "private-scope", execute);
    const replay = await withIdempotency(request(), "private-scope", execute);
    expect(first.status).toBe(500);
    expect(replay.status).toBe(500);
    expect(await replay.json()).toEqual(await first.json());
    expect(replay.headers.get("idempotent-replay")).toBe("true");
    expect(execute).toHaveBeenCalledTimes(1);
    expectSafeFailure("api.idempotency.execute");
  });

  it("reports a replay commit outage after executing exactly once", async () => {
    db = { ...db, completeApiIdempotency: async () => { throw new Error("private storage credential"); } };
    const execute = vi.fn(async () => Response.json({ created: true }));
    const response = await withIdempotency(request(), "private-scope", execute);
    expect(response.status).toBe(503);
    expect(execute).toHaveBeenCalledTimes(1);
    expectSafeFailure("api.idempotency.commit");
  });
});
