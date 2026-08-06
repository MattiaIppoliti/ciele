import process from "node:process";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CieleClient } from "@ciele/client";
import { createCieleMcpServer } from "./server.ts";

/**
 * `ciele-mcp` (#629): a local stdio MCP server over /api/v1. Configuration
 * is environment-only — the same two variables as the CLI, plus the
 * read-only switch:
 *
 *   CIELE_API_KEY        required — an org API key (Settings → API Keys)
 *   CIELE_BASE_URL       optional — self-hosted deployment origin
 *   CIELE_MCP_READ_ONLY  optional — "1"/"true": refuse every mutation
 */
export async function main(): Promise<void> {
  const apiKey = process.env.CIELE_API_KEY;
  if (!apiKey) {
    process.stderr.write(
      "ciele-mcp: CIELE_API_KEY is required (mint a key in Settings → API Keys)\n"
    );
    process.exit(1);
  }
  const readOnly = ["1", "true"].includes(
    (process.env.CIELE_MCP_READ_ONLY ?? "").toLowerCase()
  );
  const client = new CieleClient({
    apiKey,
    baseUrl: process.env.CIELE_BASE_URL,
  });

  const server = createCieleMcpServer({ client, readOnly });
  await server.connect(new StdioServerTransport());
}
