import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXIT, runCli, type CliDeps } from "./index.ts";
import { memoryConfigStore } from "./config.ts";

/** Command groups added in #628, against a stubbed fetch. */

interface Captured {
  url: string;
  method: string;
  body?: string;
  formFile?: { field: string; name: string; text: string };
}

function harness(
  respond: (c: Captured) => { status?: number; json?: unknown } = () => ({
    json: {},
  })
) {
  const calls: Captured[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const captured: Captured = {
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : undefined,
    };
    if (init?.body instanceof FormData) {
      const [field, value] = [...init.body.entries()][0];
      if (value instanceof File) {
        captured.formFile = { field, name: value.name, text: await value.text() };
      }
    }
    calls.push(captured);
    const { status = 200, json = {} } = respond(captured);
    return new Response(status === 204 ? null : JSON.stringify(json), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const deps: CliDeps = {
    env: { CIELE_API_KEY: "ciele_sk_test", CIELE_BASE_URL: "http://self.host" },
    stdout: (t) => out.push(t),
    stderr: (t) => err.push(t),
    config: memoryConfigStore(),
    fetchImpl,
  };
  return { deps, calls, out, err };
}

const tmp = () => mkdtempSync(join(tmpdir(), "ciele-cli-"));

describe("flows commands", () => {
  it("create merges --file JSON with flags (flags win) and posts it", async () => {
    const dir = tmp();
    const file = join(dir, "flow.json");
    writeFileSync(
      file,
      JSON.stringify({ name: "from-file", trigger: "message", actions: ["message"] })
    );
    const { deps, calls } = harness(() => ({ json: { id: "f1", name: "Fees" } }));
    const code = await runCli(
      ["flows", "create", "a1", "--file", file, "--name", "Fees"],
      deps
    );
    expect(code).toBe(EXIT.ok);
    expect(calls[0].url).toBe("http://self.host/api/v1/assistants/a1/flows");
    expect(JSON.parse(calls[0].body!)).toEqual({
      name: "Fees",
      trigger: "message",
      actions: ["message"],
    });
  });

  it("reorder splits --ids; delete demands --yes", async () => {
    const { deps, calls } = harness(() => ({ json: { data: [] } }));
    await runCli(["flows", "reorder", "a1", "--ids", "f2,f1"], deps);
    expect(calls[0].url).toContain("/assistants/a1/flows/reorder");
    expect(JSON.parse(calls[0].body!)).toEqual({ orderedIds: ["f2", "f1"] });

    expect(await runCli(["flows", "delete", "f1"], deps)).toBe(EXIT.usage);
    expect(calls).toHaveLength(1); // the refused delete never hit the network
  });
});

describe("knowledge commands", () => {
  it("sources add-text reads a local file; add-file uploads multipart", async () => {
    const dir = tmp();
    const textPath = join(dir, "handbook.txt");
    writeFileSync(textPath, "Tuition is due in October.");
    const { deps, calls } = harness(() => ({
      json: { id: "s1", status: "processing" },
    }));

    await runCli(["sources", "add-text", "c1", "--file", textPath], deps);
    expect(JSON.parse(calls[0].body!)).toEqual({
      kind: "text",
      name: "handbook.txt",
      text: "Tuition is due in October.",
    });

    await runCli(["sources", "add-file", "c1", "--file", textPath], deps);
    expect(calls[1].formFile).toMatchObject({
      field: "file",
      name: "handbook.txt",
      text: "Tuition is due in October.",
    });
  });

  it("faqs import streams the local CSV as multipart", async () => {
    const dir = tmp();
    const csv = join(dir, "faqs.csv");
    writeFileSync(csv, "question,answer\nQ1,A1\n");
    const { deps, calls, out } = harness(() => ({
      json: { imported: 1, skipped: [] },
    }));
    const code = await runCli(["faqs", "import", "c1", "--file", csv], deps);
    expect(code).toBe(EXIT.ok);
    expect(calls[0].url).toContain("/collections/c1/faqs/import");
    expect(calls[0].formFile?.name).toBe("faqs.csv");
    expect(out[0]).toContain("Imported 1");
  });
});

describe("publish commands", () => {
  it("status/create/restore hit the right routes; remove demands --yes", async () => {
    const { deps, calls } = harness(({ url }) =>
      url.endsWith("/publish") && !url.includes("republish")
        ? { json: { published: false } }
        : { json: { version: 2, publicationId: "p2" } }
    );
    await runCli(["publish", "status", "a1"], deps);
    expect(calls[0].method).toBe("GET");
    await runCli(["publish", "create", "a1"], deps);
    expect(calls[1].method).toBe("POST");
    await runCli(["publish", "restore", "a1", "p1"], deps);
    expect(calls[2].url).toContain("/assistants/a1/republish");
    expect(JSON.parse(calls[2].body!)).toEqual({ publicationId: "p1" });

    expect(await runCli(["publish", "remove", "a1"], deps)).toBe(EXIT.usage);
    expect(calls).toHaveLength(3);
  });
});

describe("conversations commands", () => {
  it("list forwards filters; export --out writes the records to disk", async () => {
    const dir = tmp();
    const outPath = join(dir, "export.json");
    const { deps, calls } = harness(({ url }) =>
      url.includes("/export")
        ? { json: { data: [{ ConversationId: "c1" }] } }
        : { json: { data: [], nextCursor: null } }
    );
    await runCli(
      ["conversations", "list", "--assistant", "a1", "--limit", "5"],
      deps
    );
    const listUrl = new URL(calls[0].url);
    expect(listUrl.searchParams.get("assistantId")).toBe("a1");
    expect(listUrl.searchParams.get("limit")).toBe("5");

    const code = await runCli(
      ["conversations", "export", "c1", "c2", "--out", outPath],
      deps
    );
    expect(code).toBe(EXIT.ok);
    expect(JSON.parse(calls[1].body!)).toEqual({ conversationIds: ["c1", "c2"] });
    expect(JSON.parse(readFileSync(outPath, "utf8"))).toEqual([
      { ConversationId: "c1" },
    ]);
  });

  it("pins, sends feedback, and deletes with destructive confirmation", async () => {
    const { deps, calls } = harness(({ method }) =>
      method === "DELETE" ? { status: 204 } : { json: { id: "c1", pinned: true } }
    );
    expect(await runCli(["conversations", "pin", "c1"], deps)).toBe(EXIT.ok);
    expect(
      await runCli(["conversations", "feedback", "c1", "--text", "Follow up"], deps)
    ).toBe(EXIT.ok);
    expect(await runCli(["conversations", "delete", "c1"], deps)).toBe(EXIT.usage);
    expect(await runCli(["conversations", "delete", "c1", "--yes"], deps)).toBe(EXIT.ok);
    expect(calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
      "PATCH /api/v1/conversations/c1",
      "POST /api/v1/conversations/c1/feedback",
      "DELETE /api/v1/conversations/c1",
    ]);
  });
});

describe("improvements commands", () => {
  it("update maps flags to the patch (none/empty → null, tags split)", async () => {
    const { deps, calls } = harness(() => ({ json: { id: "i1" } }));
    await runCli(
      [
        "improvements", "update", "i1",
        "--status", "in_progress",
        "--priority", "none",
        "--tags", "billing,urgent",
        "--assignee", "",
        "--due", "2026-09-01",
      ],
      deps
    );
    expect(calls[0].method).toBe("PATCH");
    expect(JSON.parse(calls[0].body!)).toEqual({
      status: "in_progress",
      priority: null,
      tags: ["billing", "urgent"],
      assigneeId: null,
      dueDate: "2026-09-01",
    });
  });
});

describe("entities and records commands", () => {
  it("creates an Entity from JSON and imports Records from CSV", async () => {
    const dir = tmp();
    const entityPath = join(dir, "orders.json");
    const csvPath = join(dir, "orders.csv");
    writeFileSync(entityPath, JSON.stringify({
      name: "Orders",
      description: "Customer orders",
      attributes: [
        { key: "order_id", label: "Order ID", type: "text" },
        { key: "status", label: "Status", type: "text" },
      ],
      keyAttribute: "order_id",
      scope: "shared",
    }));
    writeFileSync(csvPath, "order_id,status\nA-1,delayed\n");
    const { deps, calls } = harness(() => ({ json: { id: "e1", upserted: 1, rejected: [] } }));

    expect(await runCli(["entities", "create", "--file", entityPath], deps)).toBe(EXIT.ok);
    expect(JSON.parse(calls[0].body!).name).toBe("Orders");
    expect(await runCli(["records", "import", "e1", "--file", csvPath], deps)).toBe(EXIT.ok);
    expect(JSON.parse(calls[1].body!)).toEqual({
      csv: "order_id,status\nA-1,delayed\n",
    });
  });

  it("queries typed Record filters from a JSON file", async () => {
    const dir = tmp();
    const queryPath = join(dir, "query.json");
    writeFileSync(queryPath, JSON.stringify({ filters: { delayed: true }, limit: 20 }));
    const { deps, calls } = harness(() => ({ json: { data: [] } }));
    expect(await runCli(["records", "query", "e1", "--file", queryPath], deps)).toBe(EXIT.ok);
    expect(calls[0].url).toContain("/entities/e1/records/query");
    expect(JSON.parse(calls[0].body!)).toEqual({ filters: { delayed: true }, limit: 20 });
  });
});

describe("memories commands", () => {
  it("lists a subject and requires --yes before wiping it", async () => {
    const { deps, calls } = harness(({ method }) =>
      method === "GET" ? { json: { data: [] } } : { status: 204 }
    );
    expect(await runCli(["memories", "list", "user@example.com"], deps)).toBe(EXIT.ok);
    expect(calls[0].url).toContain("/memories/subjects/user%40example.com");
    expect(await runCli(["memories", "wipe", "user@example.com"], deps)).toBe(EXIT.usage);
    expect(calls).toHaveLength(1);
    expect(await runCli(["memories", "wipe", "user@example.com", "--yes"], deps)).toBe(EXIT.ok);
    expect(calls[1].method).toBe("DELETE");
  });
});

describe("Assistant Entity selection and SSO identity commands", () => {
  it("sets Entity ids without replacing the Assistant's other tools", async () => {
    const { deps, calls } = harness(() => ({ json: { entityIds: ["e1", "e2"] } }));
    expect(await runCli(["assistants", "set-entities", "a1", "--ids", "e1,e2"], deps)).toBe(EXIT.ok);
    expect(calls[0].url).toContain("/assistants/a1/entities");
    expect(JSON.parse(calls[0].body!)).toEqual({ entityIds: ["e1", "e2"] });
  });

  it("sets and clears the verified SSO identity claim", async () => {
    const { deps, calls } = harness(({ body }) => ({
      json: JSON.parse(body ?? "{}"),
    }));
    await runCli(["sso", "identity", "email"], deps);
    await runCli(["sso", "identity", "none"], deps);
    expect(calls.map((call) => JSON.parse(call.body!))).toEqual([
      { identityClaim: "email" },
      { identityClaim: null },
    ]);
  });
});

describe("help desk commands", () => {
  it("creates a desk and adds a channel from JSON", async () => {
    const dir = tmp();
    const channelPath = join(dir, "email-channel.json");
    writeFileSync(
      channelPath,
      JSON.stringify({
        kind: "email",
        name: "Email admissions",
        config: { destinationEmail: "admissions@example.edu" },
      })
    );
    const { deps, calls } = harness(({ url }) =>
      url.endsWith("/channels")
        ? { json: { id: "channel-1", kind: "email", name: "Email admissions" } }
        : { json: { id: "desk-1", name: "Admissions" } }
    );

    expect(
      await runCli(
        ["help-desks", "create", "--name", "Admissions", "--description", "Applications"],
        deps
      )
    ).toBe(EXIT.ok);
    expect(JSON.parse(calls[0].body!)).toEqual({
      name: "Admissions",
      description: "Applications",
    });

    expect(
      await runCli(
        ["help-desks", "add-channel", "desk-1", "--file", channelPath],
        deps
      )
    ).toBe(EXIT.ok);
    expect(calls[1].url).toBe("http://self.host/api/v1/help-desks/desk-1/channels");
    expect(JSON.parse(calls[1].body!)).toMatchObject({ kind: "email" });
  });
});

describe("skills, goals, and alerts commands", () => {
  it("creates a Skill, attaches it, creates a Goal, and resolves an Alert", async () => {
    const dir = tmp();
    const skillFile = join(dir, "skill.json");
    const goalFile = join(dir, "goal.json");
    writeFileSync(skillFile, JSON.stringify({ name: "Tone", prompt: "Be concise." }));
    writeFileSync(
      goalFile,
      JSON.stringify({
        question: "When is tuition due?",
        expectations: { mustCiteSources: true },
      })
    );
    const { deps, calls } = harness(({ url, method }) => {
      if (url.endsWith("/skills") && method === "POST") return { json: { id: "s1" } };
      if (url.endsWith("/skills") && method === "PATCH") return { json: { data: [{ id: "s1" }] } };
      if (url.endsWith("/goals")) return { json: { id: "g1" } };
      return { json: { id: "alert-1", status: "resolved" } };
    });

    expect(await runCli(["skills", "create", "--file", skillFile], deps)).toBe(EXIT.ok);
    expect(await runCli(["assistants", "set-skills", "a1", "--ids", "s1"], deps)).toBe(EXIT.ok);
    expect(await runCli(["goals", "create", "a1", "--file", goalFile], deps)).toBe(EXIT.ok);
    expect(await runCli(["alerts", "resolve", "alert-1"], deps)).toBe(EXIT.ok);

    expect(calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
      "POST /api/v1/skills",
      "PATCH /api/v1/assistants/a1/skills",
      "POST /api/v1/assistants/a1/goals",
      "POST /api/v1/alerts/alert-1/resolve",
    ]);
  });
});

describe("organization administration commands", () => {
  it("invites a member, changes a role, and mints an API key", async () => {
    const { deps, calls, out } = harness(({ url }) => {
      if (url.endsWith("/invites")) return { json: { id: "invite-1" } };
      if (url.endsWith("/api-keys")) {
        return {
          json: {
            apiKey: { id: "key-2", name: "CI", role: "editor" },
            secret: "ciele_sk_once",
          },
        };
      }
      return { json: { ok: true } };
    });

    expect(
      await runCli(
        ["invites", "create", "--email", "dev@example.edu", "--role", "viewer"],
        deps
      )
    ).toBe(EXIT.ok);
    expect(
      await runCli(["members", "set-role", "user-2", "--role", "editor"], deps)
    ).toBe(EXIT.ok);
    expect(
      await runCli(["api-keys", "create", "--name", "CI", "--role", "editor"], deps)
    ).toBe(EXIT.ok);
    expect(out[2]).toContain("ciele_sk_once");
    expect(calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
      "POST /api/v1/invites",
      "PATCH /api/v1/members/user-2",
      "POST /api/v1/api-keys",
    ]);
  });
});

describe("integration and provider commands", () => {
  it("configures an Assistant API, SSO, and an OpenAI-compatible provider", async () => {
    const dir = tmp();
    const apiFile = join(dir, "api.json");
    const ssoFile = join(dir, "sso.json");
    const providerFile = join(dir, "provider.json");
    writeFileSync(apiFile, JSON.stringify({
      name: "Student API",
      baseUrl: "https://api.example.edu",
      authType: "none",
      endpoints: [{ id: "courses", name: "Courses", purpose: "List", method: "GET", path: "/courses" }],
    }));
    writeFileSync(ssoFile, JSON.stringify({
      provider: "entra",
      clientId: "client",
      tenantId: "tenant",
      clientSecret: "secret",
    }));
    writeFileSync(providerFile, JSON.stringify({
      displayName: "Local",
      baseUrl: "http://127.0.0.1:11434/v1",
      chatModel: "llama3",
    }));
    const { deps, calls } = harness(() => ({ json: { ok: true } }));

    expect(await runCli(["api-integrations", "set", "a1", "--file", apiFile], deps)).toBe(EXIT.ok);
    expect(await runCli(["sso", "connect", "--file", ssoFile], deps)).toBe(EXIT.ok);
    expect(await runCli(["providers", "create-compatible", "--file", providerFile], deps)).toBe(EXIT.ok);
    expect(calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
      "PUT /api/v1/assistants/a1/api-integration",
      "PUT /api/v1/sso/connection",
      "POST /api/v1/providers/openai-compatible",
    ]);
  });
});
