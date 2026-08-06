import { describe, expect, it } from "vitest";
import { CieleClient } from "@ciele/client";
import { callTool } from "./server.ts";
import { buildTools, type CieleTool } from "./tools.ts";

/** Tool calls against a stubbed fetch: request shapes + the read-only gate. */

interface Captured {
  url: string;
  method: string;
  body?: string;
  formFile?: { name: string; text: string };
}

function harness(
  respond: (c: Captured) => { status?: number; json?: unknown } = () => ({
    json: { ok: true },
  })
) {
  const calls: Captured[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const captured: Captured = {
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : undefined,
    };
    if (init?.body instanceof FormData) {
      const value = init.body.get("file");
      if (value instanceof File) {
        captured.formFile = { name: value.name, text: await value.text() };
      }
    }
    calls.push(captured);
    const { status = 200, json = {} } = respond(captured);
    return new Response(status === 204 ? null : JSON.stringify(json), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const client = new CieleClient({
    apiKey: "ciele_sk_test",
    baseUrl: "http://self.host",
    fetch: fetchImpl,
  });
  const tools = new Map(buildTools(client).map((t) => [t.name, t]));
  const tool = (name: string): CieleTool => {
    const found = tools.get(name);
    if (!found) throw new Error(`no tool ${name}`);
    return found;
  };
  return { calls, tool, tools };
}

describe("ciele MCP tools", () => {
  it("registers the coarse tool set covering every domain", () => {
    const { tools } = harness();
    expect([...tools.keys()].sort()).toEqual([
      "ciele_identity",
      "manage_assistants",
      "manage_flows",
      "manage_improvements",
      "manage_knowledge",
      "publish_assistant",
      "read_inbox",
    ]);
  });

  it("tool calls become the right API requests", async () => {
    const { calls, tool } = harness();

    await callTool(tool("manage_assistants"), { action: "create", title: "Bot" }, false);
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: "http://self.host/api/v1/assistants",
    });
    expect(JSON.parse(calls[0].body!).title).toBe("Bot");

    await callTool(
      tool("manage_flows"),
      { action: "update", id: "f1", flow: { enabled: false } },
      false
    );
    expect(calls[1]).toMatchObject({ method: "PATCH" });
    expect(calls[1].url).toContain("/flows/f1");

    await callTool(
      tool("manage_knowledge"),
      {
        action: "add_file",
        collectionId: "c1",
        name: "notes.txt",
        fileBase64: Buffer.from("hello").toString("base64"),
      },
      false
    );
    expect(calls[2].formFile).toEqual({ name: "notes.txt", text: "hello" });

    await callTool(
      tool("manage_knowledge"),
      { action: "import_faqs", collectionId: "c1", csvText: "question,answer\nQ,A\n" },
      false
    );
    expect(calls[3].url).toContain("/collections/c1/faqs/import");
    expect(calls[3].formFile?.name).toBe("faqs.csv");

    await callTool(tool("publish_assistant"), { action: "publish", assistantId: "a1" }, false);
    expect(calls[4]).toMatchObject({ method: "POST" });
    expect(calls[4].url).toContain("/assistants/a1/publish");

    await callTool(
      tool("read_inbox"),
      { action: "export", conversationIds: ["c1", "c2"] },
      false
    );
    expect(JSON.parse(calls[5].body!)).toEqual({ conversationIds: ["c1", "c2"] });
  });

  it("read-only mode refuses every mutation before it reaches the network", async () => {
    const { calls, tool, tools } = harness();
    const mutating: Array<[string, Record<string, unknown>]> = [
      ["manage_assistants", { action: "delete", id: "a1" }],
      ["manage_assistants", { action: "create", title: "x" }],
      ["manage_flows", { action: "reorder", assistantId: "a1", orderedIds: [] }],
      ["manage_knowledge", { action: "add_text", collectionId: "c1", text: "x" }],
      ["manage_knowledge", { action: "delete_source", sourceId: "s1" }],
      ["publish_assistant", { action: "unpublish", assistantId: "a1" }],
      ["manage_improvements", { action: "update", id: "i1", patch: {} }],
    ];
    for (const [name, args] of mutating) {
      const result = await callTool(tool(name), args, true);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Read-only mode");
    }
    expect(calls).toHaveLength(0);

    // Reads still work in read-only mode.
    const listed = await callTool(tool("manage_assistants"), { action: "list" }, true);
    expect(listed.isError).toBeUndefined();
    const status = await callTool(
      tool("publish_assistant"),
      { action: "status", assistantId: "a1" },
      true
    );
    expect(status.isError).toBeUndefined();
    expect(calls.length).toBe(2);

    // Every tool declares read-only-safe reads: identity and inbox never mutate.
    expect(tools.get("ciele_identity")!.mutates({})).toBe(false);
    expect(tools.get("read_inbox")!.mutates({ action: "export" })).toBe(false);
  });

  it("missing per-action fields and API errors become error results, not throws", async () => {
    const { tool } = harness(() => ({
      status: 403,
      json: { error: { code: "forbidden", message: "role too low" } },
    }));

    const missing = await callTool(tool("manage_assistants"), { action: "get" }, false);
    expect(missing.isError).toBe(true);
    expect(missing.content[0].text).toContain('"id" is required');

    const denied = await callTool(
      tool("manage_assistants"),
      { action: "delete", id: "a1" },
      false
    );
    expect(denied.isError).toBe(true);
    expect(denied.content[0].text).toBe("403 forbidden: role too low");
  });

  it("results serialize as JSON text content", async () => {
    const { tool } = harness(() => ({ json: { data: [{ id: "a1" }] } }));
    const result = await callTool(tool("manage_assistants"), { action: "list" }, false);
    expect(result.content[0].type).toBe("text");
    expect(JSON.parse(result.content[0].text)).toEqual({ data: [{ id: "a1" }] });
  });
});
