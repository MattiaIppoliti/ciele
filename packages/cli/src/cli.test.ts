import { describe, expect, it } from "vitest";
import { EXIT, runCli, type CliDeps } from "./index.ts";
import { memoryConfigStore } from "./config.ts";

/**
 * The CLI against a stubbed fetch: parsing → request shape, credential
 * precedence, output modes, exit codes. No network, no filesystem.
 */

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function harness(
  respond: (c: Captured) => { status?: number; json?: unknown } = () => ({
    json: {},
  }),
  overrides: Partial<CliDeps> = {}
) {
  const calls: Captured[] = [];
  const out: string[] = [];
  const err: string[] = [];
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

  const deps: CliDeps = {
    env: {},
    stdout: (t) => out.push(t),
    stderr: (t) => err.push(t),
    config: memoryConfigStore(),
    fetchImpl,
    ...overrides,
  };
  return { deps, calls, out, err };
}

const WHOAMI = { organizationId: "org-1", role: "editor", keyId: "k-1" };

describe("ciele CLI", () => {
  it("login validates the key via whoami, stores it, and whoami reuses it", async () => {
    const { deps, calls, out } = harness(() => ({ json: WHOAMI }));
    const code = await runCli(
      ["login", "--key", "ciele_sk_abc", "--base-url", "http://self.host"],
      deps
    );
    expect(code).toBe(EXIT.ok);
    expect(calls[0].url).toBe("http://self.host/api/v1/whoami");
    expect(calls[0].headers.authorization).toBe("Bearer ciele_sk_abc");
    expect(deps.config.load()).toEqual({
      apiKey: "ciele_sk_abc",
      baseUrl: "http://self.host",
    });
    expect(out[0]).toContain("org-1");

    // Subsequent commands read the stored credential and base URL.
    await runCli(["whoami"], deps);
    expect(calls[1].url).toBe("http://self.host/api/v1/whoami");
    expect(calls[1].headers.authorization).toBe("Bearer ciele_sk_abc");
  });

  it("login with a rejected key stores nothing and exits auth", async () => {
    const { deps } = harness(() => ({
      status: 401,
      json: { error: { code: "unauthorized", message: "nope" } },
    }));
    const code = await runCli(["login", "--key", "ciele_sk_bad"], deps);
    expect(code).toBe(EXIT.auth);
    expect(deps.config.load()).toEqual({});
  });

  it("env beats config, flag beats env", async () => {
    const { deps, calls } = harness(() => ({ json: WHOAMI }), {
      env: { CIELE_API_KEY: "ciele_sk_env", CIELE_BASE_URL: "http://env.host" },
    });
    deps.config.save({ apiKey: "ciele_sk_file", baseUrl: "http://file.host" });

    await runCli(["whoami"], deps);
    expect(calls[0].url).toBe("http://env.host/api/v1/whoami");
    expect(calls[0].headers.authorization).toBe("Bearer ciele_sk_env");

    await runCli(["whoami", "--api-key", "ciele_sk_flag"], deps);
    expect(calls[1].headers.authorization).toBe("Bearer ciele_sk_flag");
  });

  it("refuses to run authenticated commands with no key (exit 3)", async () => {
    const { deps, err } = harness();
    const code = await runCli(["assistants", "list"], deps);
    expect(code).toBe(EXIT.auth);
    expect(err[0]).toContain("ciele login");
  });

  it("assistants commands build the right requests; --json emits raw data", async () => {
    const assistant = { id: "a1", title: "Bot", nickname: "b", createdAt: "2026" };
    const { deps, calls, out } = harness(({ method }) =>
      method === "DELETE"
        ? { status: 204 }
        : { json: { data: [assistant], nextCursor: null } }
    , { env: { CIELE_API_KEY: "ciele_sk_x" } });

    expect(await runCli(["assistants", "list", "--limit", "2", "--json"], deps)).toBe(
      EXIT.ok
    );
    expect(calls[0].url).toBe(
      "https://platform.ciele.app/api/v1/assistants?limit=2"
    );
    expect(JSON.parse(out[0]).data[0].id).toBe("a1");

    await runCli(
      ["assistants", "create", "--title", "New bot", "--description", "d"],
      deps
    );
    expect(calls[1].method).toBe("POST");
    expect(JSON.parse(calls[1].body!)).toEqual({
      title: "New bot",
      nickname: undefined,
      description: "d",
    });

    await runCli(
      ["assistants", "update", "a1", "--answering-style", "terse"],
      deps
    );
    expect(calls[2].method).toBe("PATCH");
    expect(calls[2].url).toContain("/assistants/a1");
    expect(JSON.parse(calls[2].body!)).toEqual({ answeringStyle: "terse" });

    expect(await runCli(["assistants", "delete", "a1", "--yes"], deps)).toBe(
      EXIT.ok
    );
    expect(calls[3].method).toBe("DELETE");
  });

  it("human output is a table, not JSON", async () => {
    const { deps, out } = harness(() => ({
      json: {
        data: [{ id: "a1", title: "Bot", nickname: "b", createdAt: "2026" }],
        nextCursor: null,
      },
    }), { env: { CIELE_API_KEY: "ciele_sk_x" } });
    await runCli(["assistants", "list"], deps);
    expect(out[0]).toContain("ID");
    expect(out[0]).toContain("Bot");
    expect(() => JSON.parse(out[0])).toThrow();
  });

  it("distinct exit codes: usage 2 (bad args, 4xx), server 1 (5xx)", async () => {
    const { deps } = harness(() => ({
      status: 500,
      json: { error: { code: "boom", message: "down" } },
    }), { env: { CIELE_API_KEY: "ciele_sk_x" } });

    expect(await runCli(["assistants", "create"], deps)).toBe(EXIT.usage); // no --title
    expect(await runCli(["assistants", "delete", "a1"], deps)).toBe(EXIT.usage); // no --yes
    expect(await runCli(["nonsense"], deps)).toBe(EXIT.usage);
    expect(await runCli(["assistants", "list"], deps)).toBe(EXIT.error); // 500

    const notFound = harness(() => ({
      status: 404,
      json: { error: { code: "not_found", message: "gone" } },
    }), { env: { CIELE_API_KEY: "ciele_sk_x" } });
    expect(await runCli(["assistants", "get", "missing"], notFound.deps)).toBe(
      EXIT.usage
    );
  });

  it("help exits 0 without touching the network", async () => {
    const { deps, calls, out } = harness();
    expect(await runCli([], deps)).toBe(EXIT.ok);
    expect(await runCli(["help"], deps)).toBe(EXIT.ok);
    expect(calls).toHaveLength(0);
    expect(out[0]).toContain("Usage: ciele");
  });
});
