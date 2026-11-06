import { describe, expect, it, vi } from "vitest";
import { apiKeySecretHint, generateApiKeySecret, hashApiKeySecret } from "@agent-hub/core";
import { DEMO_MEMBER, DEMO_ORG, getMockDb } from "@agent-hub/db";
import { DELETE as mcpDelete, GET as mcpGet, POST as mcpRoute } from "./route";
import { mcpRouteContract, modern, payload, toolCall } from "./route-contract.suite";

/**
 * The hosted MCP endpoint (#702) at the route seam. The contract every server
 * answering /api/mcp must pass lives in `route-contract.suite.ts`, which the
 * Rust parity test runs against the service too; this file runs it against
 * the Next.js route on the mock Db, plus what only the route has to prove.
 */

async function mintKey(role: "owner" | "viewer" = "owner") {
  const secret = generateApiKeySecret();
  await getMockDb().createApiKey(DEMO_ORG.id, {
    name: `mcp ${role} key`,
    role,
    roleId: `builtin:${role}`,
    secretHash: hashApiKeySecret(secret),
    secretHint: apiKeySecretHint(secret),
    createdBy: DEMO_MEMBER.userId,
  });
  return secret;
}

/** Stub every outbound fetch, record its URL, and restore it after `run`. */
async function recordingFetch<T>(run: (urls: string[]) => Promise<T>): Promise<T> {
  const urls: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
    urls.push(String(input instanceof Request ? input.url : input));
    return Response.json({ ok: true });
  }) as unknown as typeof fetch;
  try {
    return await run(urls);
  } finally {
    globalThis.fetch = realFetch;
  }
}

describe("POST /api/mcp", () => {
  mcpRouteContract(() => ({
    post: mcpRoute,
    probe: (method) => (method === "GET" ? mcpGet : mcpDelete)(new Request("http://test.local/api/mcp", { method })),
    key: mintKey,
    outbound: async (send) => {
      const prior = process.env.CIELE_INTERNAL_API_ORIGIN;
      process.env.CIELE_INTERNAL_API_ORIGIN = "http://app.internal:3000";
      try {
        return await recordingFetch(async (urls) => {
          await send();
          return { urls, origin: "http://app.internal:3000" };
        });
      } finally {
        if (prior === undefined) delete process.env.CIELE_INTERNAL_API_ORIGIN;
        else process.env.CIELE_INTERNAL_API_ORIGIN = prior;
      }
    },
  }));

  /**
   * `CIELE_MCP_READ_ONLY=1` holds here too, not only on stdio and in the Rust
   * service: with the endpoint kept in the app (CIELE_RUST_MCP=0) a write
   * must still be refused before any request leaves.
   */
  it("refuses a write under CIELE_MCP_READ_ONLY=1, with the stdio server's words", async () => {
    const secret = await mintKey();
    const prior = process.env.CIELE_MCP_READ_ONLY;
    process.env.CIELE_MCP_READ_ONLY = "1";
    const call = (name: string, args: Record<string, unknown>) => toolCall(secret, name, args);
    try {
      await recordingFetch(async (outbound) => {
        const refused = await payload(await mcpRoute(call("manage_assistants", { action: "delete", id: "a" })));
        expect(refused.result.isError).toBe(true);
        expect(refused.result.content[0].text).toBe(
          'Read-only mode: "manage_assistants" action "delete" would write. Unset CIELE_MCP_READ_ONLY to allow mutations.'
        );
        expect(outbound).toEqual([]);

        const listed = await payload(await mcpRoute(modern(secret, "tools/list")));
        expect(listed.result.tools[0].description).toContain("READ-ONLY mode");

        // A read still goes through.
        const read = await payload(await mcpRoute(call("manage_assistants", { action: "list" })));
        expect(read.result.isError).toBeUndefined();
        expect(outbound.length).toBeGreaterThan(0);
      });
    } finally {
      if (prior === undefined) delete process.env.CIELE_MCP_READ_ONLY;
      else process.env.CIELE_MCP_READ_ONLY = prior;
    }
  });
});
