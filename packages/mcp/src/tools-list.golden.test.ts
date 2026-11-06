import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { CieleClient } from "@ciele/client";
import { createCieleMcpServer } from "./server.ts";
import { buildTools } from "./tools.ts";

/**
 * The tool list as this server puts it on the wire (#1135), recorded.
 *
 * `services/ciele-api` serves the hosted MCP endpoint too, and its `tools/list`
 * must be these bytes: it embeds the two files below, and its own test and the
 * MCP parity test in `apps/web` compare what it answers with them. A change to
 * a tool's name, description or schema therefore fails here first:
 *
 *   CIELE_MCP_GOLDEN=update pnpm --filter @ciele/mcp exec vitest run tools-list.golden
 *
 * rewrites the files, and the Rust build picks them up.
 *
 * `mutates.json` is the read-only boundary: for every tool and every action its
 * schema offers, whether `tool.mutates(args)` calls it a write. `"(absent)"`
 * is a call with no action at all. The Rust service's `mutates` is tested
 * against this file, so the two cannot drift.
 */

const META = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientInfo": { name: "golden", version: "1" },
  "io.modelcontextprotocol/clientCapabilities": {},
};

async function wireTools(readOnly: boolean): Promise<string> {
  const client = new CieleClient({ apiKey: "ciele_sk_golden", baseUrl: "http://golden.invalid" });
  const handler = createMcpHandler(() => createCieleMcpServer({ client, readOnly }));
  const response = await handler.fetch(
    new Request("http://golden.invalid/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-method": "tools/list",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: META } }),
    })
  );
  const body = (await response.json()) as { result: { tools: unknown[] } };
  // Key order is the wire's: JSON.parse keeps it and stringify writes it back.
  return `${JSON.stringify(body.result.tools, null, 2)}\n`;
}

const GOLDEN = {
  "tools-list.json": false,
  "tools-list.read-only.json": true,
} as const;

describe("the recorded tools/list (#1135)", () => {
  for (const [file, readOnly] of Object.entries(GOLDEN)) {
    it(`${file} is what the server lists`, async () => {
      const path = new URL(`../golden/${file}`, import.meta.url);
      const listed = await wireTools(readOnly);
      if (process.env.CIELE_MCP_GOLDEN === "update") writeFileSync(path, listed);
      expect(listed).toBe(readFileSync(path, "utf8"));
    });
  }
});

/** Every (tool, action) pair the schemas allow, and `tool.mutates` for each. */
function mutatesTable(): string {
  const client = new CieleClient({ apiKey: "ciele_sk_golden", baseUrl: "http://golden.invalid" });
  const table: Record<string, Record<string, boolean>> = {};
  for (const tool of buildTools(client)) {
    const action = tool.schema.action as { options?: readonly string[] } | undefined;
    const row: Record<string, boolean> = { "(absent)": tool.mutates({}) };
    for (const name of action?.options ?? []) row[name] = tool.mutates({ action: name });
    table[tool.name] = row;
  }
  return `${JSON.stringify(table, null, 2)}\n`;
}

describe("the recorded read-only boundary (#1135)", () => {
  it("mutates.json is what every tool's mutates() answers", () => {
    const path = new URL("../golden/mutates.json", import.meta.url);
    const table = mutatesTable();
    if (process.env.CIELE_MCP_GOLDEN === "update") writeFileSync(path, table);
    expect(table).toBe(readFileSync(path, "utf8"));
  });
});
