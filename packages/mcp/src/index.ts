import process from "node:process";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { CieleClient } from "@ciele/client";
import { createCieleMcpServer } from "./server.ts";

/**
 * `ciele-mcp` (#629): a local stdio MCP server over /api/v1. Configuration
 * is environment-only — the same two variables as the CLI, plus two switches:
 *
 *   CIELE_API_KEY          required — an org API key (Settings → API Keys)
 *   CIELE_BASE_URL         optional — self-hosted deployment origin
 *   CIELE_MCP_READ_ONLY    optional — "1"/"true": refuse every mutation
 *   CIELE_MCP_MODERN_ONLY  optional — "1"/"true": refuse 2025-era clients
 */

const flag = (value: string | undefined) =>
  ["1", "true"].includes((value ?? "").toLowerCase());

export async function main(): Promise<void> {
  const apiKey = process.env.CIELE_API_KEY;
  if (!apiKey) {
    process.stderr.write(
      "ciele-mcp: CIELE_API_KEY is required (mint a key in Settings → API Keys)\n"
    );
    process.exit(1);
  }
  const readOnly = flag(process.env.CIELE_MCP_READ_ONLY);
  const client = new CieleClient({
    apiKey,
    baseUrl: process.env.CIELE_BASE_URL,
  });

  // `serveStdio` decides the era from the opening exchange and pins one
  // instance per connection (#700). Default `legacy: 'serve'` keeps 2025-era
  // clients working — as of 2026-08 that is every client we advertise; the
  // switch is how the modern-only end state gets flipped when they catch up.
  // The CieleClient is shared across eras deliberately: it holds no
  // per-connection state, only the key and base URL.
  serveStdio(() => createCieleMcpServer({ client, readOnly }), {
    legacy: flag(process.env.CIELE_MCP_MODERN_ONLY) ? "reject" : "serve",
  });
}
