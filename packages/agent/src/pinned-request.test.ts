import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pinnedRequest } from "./pinned-fetch";

/**
 * Real-socket coverage of the pinned transport: method/body pass-through,
 * the streamed response-size cap, timeout, caller aborts, and that redirects
 * are never followed. (pinned-fetch.test.ts covers the DNS-pinning lookup
 * contract with a mocked transport.)
 */

let server: Server;
let port: number;

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/echo") {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            method: req.method,
            body: Buffer.concat(chunks).toString("utf8"),
            contentType: req.headers["content-type"] ?? null,
          })
        );
      });
      return;
    }
    if (url.pathname === "/big") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(Buffer.alloc(64 * 1024, "x"));
      return;
    }
    if (url.pathname === "/declares-big") {
      res.writeHead(200, { "content-length": String(10 * 1024 * 1024) });
      res.write("start");
      return;
    }
    if (url.pathname === "/redirect") {
      res.writeHead(302, { location: "/echo" });
      res.end();
      return;
    }
    if (url.pathname === "/never") {
      return; // hold the socket open without responding
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

function target(path: string) {
  // Hostname "localhost" + pinned 127.0.0.1 exercises the lookup override.
  return {
    url: new URL(`http://localhost:${port}${path}`),
    addresses: ["127.0.0.1"],
  };
}

describe("pinnedRequest", () => {
  it("sends the method, headers and body", async () => {
    const response = await pinnedRequest(target("/echo"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"subject":"Help"}',
      timeoutMs: 5_000,
    });
    expect(response.ok).toBe(true);
    expect(JSON.parse(response.text)).toEqual({
      method: "POST",
      body: '{"subject":"Help"}',
      contentType: "application/json",
    });
  });

  it("destroys the request once the streamed body exceeds the cap", async () => {
    await expect(
      pinnedRequest(target("/big"), { timeoutMs: 5_000, maxResponseBytes: 1024 })
    ).rejects.toThrow(/size limit/i);
  });

  it("fails fast on a Content-Length above the cap", async () => {
    await expect(
      pinnedRequest(target("/declares-big"), {
        timeoutMs: 5_000,
        maxResponseBytes: 1024,
      })
    ).rejects.toThrow(/size limit/i);
  });

  it("returns a body within the cap intact", async () => {
    const response = await pinnedRequest(target("/big"), {
      timeoutMs: 5_000,
      maxResponseBytes: 128 * 1024,
    });
    expect(response.text).toHaveLength(64 * 1024);
  });

  it("does not follow redirects — the 3xx surfaces to the caller", async () => {
    const response = await pinnedRequest(target("/redirect"), {
      timeoutMs: 5_000,
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/echo");
  });

  it("times out a silent endpoint", async () => {
    await expect(
      pinnedRequest(target("/never"), { timeoutMs: 200 })
    ).rejects.toThrow(/timed out/i);
  });

  it("aborts on the caller's signal", async () => {
    const controller = new AbortController();
    const pending = pinnedRequest(target("/never"), {
      timeoutMs: 10_000,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(new Error("turn cancelled")), 50);
    await expect(pending).rejects.toThrow(/turn cancelled/);
  });
});
