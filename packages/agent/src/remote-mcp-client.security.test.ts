import { createServer } from "node:http";
import { afterEach, expect, it } from "vitest";
import { discoverRemoteMcpTools } from "./remote-mcp-client";
import { registerRuntimeHost, resetRuntimeHost } from "./host";
afterEach(resetRuntimeHost);
it("refuses plain HTTP and private MCP endpoints in production", async () => {
  for (const url of ["http://example.com/mcp", "https://127.0.0.1/mcp", "https://10.0.0.1/mcp"]) await expect(discoverRemoteMcpTools({ url, token: null })).rejects.toThrow();
});
it("never follows a redirect carrying an MCP bearer token", async () => {
  registerRuntimeHost({ allowRelaxedEgress: () => true });
  let redirected = 0;
  const server = createServer((request, response) => {
    if (request.url === "/destination") { redirected += 1; response.writeHead(200).end(); }
    else response.writeHead(302, { location: "/destination" }).end();
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test server address");
    await expect(discoverRemoteMcpTools({ url: `http://127.0.0.1:${address.port}/mcp`, token: "synthetic-redirect-token" })).rejects.toThrow();
    expect(redirected).toBe(0);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
it("caps response bytes and strips credential echoes from failures", async () => {
  registerRuntimeHost({ allowRelaxedEgress: () => true });
  const token = "test-token";
  const server = createServer((_request, response) => response.writeHead(500).end(`Bearer ${token} ${"x".repeat(1024 * 1024)}`));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test server address");
    const failure = await discoverRemoteMcpTools({ url: `http://127.0.0.1:${address.port}/mcp`, token }).catch(error => error);
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).not.toContain(token);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
