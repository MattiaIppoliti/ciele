import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { afterAll, beforeAll, expect, it } from "vitest";
import { pinnedStreamingRequest } from "./pinned-fetch";
let server: Server;
let port: number;
beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.url === "/empty") {
      response.writeHead(204);
      response.end();
      return;
    }
    response.writeHead(200, { "content-type": "text/event-stream" });
    if (request.url === "/oversized") {
      response.end("x".repeat(1000));
      return;
    }
    response.write("data: first\n\n");
    const timer = setInterval(() => response.write("data: next\n\n"), 50);
    response.on("close", () => clearInterval(timer));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No test listener");
  port = address.port;
});
afterAll(async () => {
  server.closeAllConnections();
  server.close();
  await once(server, "close");
});
const target = (path: string) => ({
  url: new URL(`http://harness.invalid:${port}${path}`),
  addresses: ["127.0.0.1"],
});
it("pins DNS and makes body cancellation safe for an unfinished response", async () => {
  const response = await pinnedStreamingRequest(target("/stream"), {
    timeoutMs: 5000,
  });
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response stream");
  expect(new TextDecoder().decode((await reader.read()).value)).toContain(
    "first",
  );
  await reader.cancel();
  expect(await reader.read()).toEqual({ done: true, value: undefined });
});
it("fails an oversized stream and an aborted request after its headers arrived", async () => {
  const oversized = await pinnedStreamingRequest(target("/oversized"), {
    timeoutMs: 5000,
    maxResponseBytes: 100,
  });
  await expect(oversized.text()).rejects.toThrow("size limit");
  const controller = new AbortController();
  const response = await pinnedStreamingRequest(target("/stream"), {
    timeoutMs: 5000,
    signal: controller.signal,
  });
  controller.abort();
  await expect(response.text()).rejects.toThrow(/aborted|cancelled/);
});
it("returns bodyless HTTP responses for the caller to reject without a stream-constructor exception", async () => {
  const response = await pinnedStreamingRequest(target("/empty"), {
    timeoutMs: 5000,
  });
  expect(response.status).toBe(204);
  expect(response.body).toBeNull();
});
