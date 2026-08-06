import { describe, expect, it } from "vitest";
import { CieleApiError, CieleClient } from "./index";

/**
 * The client against a stubbed fetch: request shapes (URL, headers, body)
 * and response handling (envelope errors, 204, pagination) — no network.
 */

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function stub(
  respond: (captured: Captured) => { status?: number; json?: unknown }
) {
  const calls: Captured[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const captured: Captured = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>).map(
          ([k, v]) => [k.toLowerCase(), v]
        )
      ),
      body: typeof init?.body === "string" ? init.body : undefined,
    };
    calls.push(captured);
    const { status = 200, json = {} } = respond(captured);
    return new Response(status === 204 ? null : JSON.stringify(json), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const client = (fetchImpl: typeof fetch, baseUrl = "https://self.host/") =>
  new CieleClient({ apiKey: "ciele_sk_test", baseUrl, fetch: fetchImpl });

describe("CieleClient", () => {
  it("builds requests: base URL, bearer auth, JSON body, idempotency key", async () => {
    const { calls, fetchImpl } = stub(() => ({ json: { id: "a1" } }));
    await client(fetchImpl).assistants.create(
      { title: "From client" },
      { idempotencyKey: "once" }
    );
    expect(calls[0].url).toBe("https://self.host/api/v1/assistants");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers.authorization).toBe("Bearer ciele_sk_test");
    expect(calls[0].headers["content-type"]).toBe("application/json");
    expect(calls[0].headers["idempotency-key"]).toBe("once");
    expect(JSON.parse(calls[0].body!)).toEqual({ title: "From client" });
  });

  it("throws the envelope as a typed error", async () => {
    const { fetchImpl } = stub(() => ({
      status: 403,
      json: { error: { code: "forbidden", message: "role too low" } },
    }));
    const error = await client(fetchImpl)
      .assistants.delete("a1")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CieleApiError);
    expect(error).toMatchObject({ status: 403, code: "forbidden" });
  });

  it("treats 204 as void and query params as strings", async () => {
    const { calls, fetchImpl } = stub(({ method }) =>
      method === "DELETE" ? { status: 204 } : { json: { data: [], nextCursor: null } }
    );
    const c = client(fetchImpl);
    await expect(c.flows.delete("f1")).resolves.toBeUndefined();
    await c.assistants.list({ limit: 5, cursor: "abc" });
    expect(calls[1].url).toBe(
      "https://self.host/api/v1/assistants?limit=5&cursor=abc"
    );
  });

  it("listAll walks cursors to exhaustion without duplicates", async () => {
    const pages: Record<string, unknown> = {
      none: { data: [{ id: "a" }, { id: "b" }], nextCursor: "b" },
      b: { data: [{ id: "c" }], nextCursor: null },
    };
    const { fetchImpl } = stub(({ url }) => {
      const cursor = new URL(url).searchParams.get("cursor") ?? "none";
      return { json: pages[cursor] };
    });
    const seen: string[] = [];
    for await (const a of client(fetchImpl).assistants.listAll()) seen.push(a.id);
    expect(seen).toEqual(["a", "b", "c"]);
  });

  it("meta hits the discovery endpoint on the configured deployment", async () => {
    const { calls, fetchImpl } = stub(() => ({
      json: { api: "ciele", apiVersion: 1, serverVersion: "dev", domains: [] },
    }));
    const meta = await client(fetchImpl, "http://localhost:3000").meta();
    expect(calls[0].url).toBe("http://localhost:3000/api/v1/meta");
    expect(meta.apiVersion).toBe(1);
  });
});
