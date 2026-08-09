import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

describe("ciele MCP stdio process", () => {
  it("initializes, lists every tool, and calls the local Ciele API", async () => {
    const requests: string[] = [];
    const api = createServer((request, response) => {
      requests.push(request.url ?? "");
      response.setHeader("content-type", "application/json");
      if (request.headers.authorization !== "Bearer ciele_sk_stdio_test") {
        response.statusCode = 401;
        response.end(JSON.stringify({ error: { code: "unauthorized", message: "Bad key" } }));
      } else if (request.url === "/api/v1/meta") {
        response.end(JSON.stringify({
          api: "ciele",
          apiVersion: 1,
          serverVersion: "stdio-test",
          domains: ["assistants", "providers"],
        }));
      } else if (request.url === "/api/v1/whoami") {
        response.end(JSON.stringify({
          organizationId: "org-stdio",
          role: "viewer",
          keyId: "key-stdio",
        }));
      } else {
        response.statusCode = 404;
        response.end(JSON.stringify({ error: { code: "not_found", message: "Not found" } }));
      }
    });
    await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));

    const address = api.address();
    if (!address || typeof address === "string") throw new Error("No API test port");
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(packageRoot, "bin/ciele-mcp.mjs")],
      cwd: packageRoot,
      env: {
        CIELE_API_KEY: "ciele_sk_stdio_test",
        CIELE_BASE_URL: `http://127.0.0.1:${address.port}`,
        CIELE_MCP_READ_ONLY: "1",
      },
      stderr: "pipe",
    });
    const client = new Client({ name: "ciele-stdio-test", version: "1.0.0" });

    try {
      await client.connect(transport);
      expect(client.getServerVersion()).toMatchObject({ name: "ciele" });

      const listed = await client.listTools();
      expect(listed.tools).toHaveLength(14);
      expect(listed.tools.map((tool) => tool.name)).toContain("manage_integrations");
      expect(listed.tools[0]?.description).toContain("READ-ONLY mode");

      const result = await client.callTool({ name: "ciele_identity", arguments: {} });
      expect(result.isError).not.toBe(true);
      const content = (result as {
        content: Array<{ type: string; text?: string }>;
      }).content;
      const text = content.find(
        (item) => item.type === "text"
      )?.text;
      expect(JSON.parse(text ?? "null")).toMatchObject({
        meta: { serverVersion: "stdio-test" },
        whoami: { organizationId: "org-stdio", role: "viewer" },
      });
      expect(requests.sort()).toEqual(["/api/v1/meta", "/api/v1/whoami"]);
    } finally {
      await client.close();
      await new Promise<void>((resolve, reject) =>
        api.close((error) => (error ? reject(error) : resolve()))
      );
    }
  }, 15_000);
});
