import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reportError } from "@agent-hub/diagnostics";
import { withRequestDiagnostics } from "./request-diagnostics";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("request diagnostics", () => {
  it("preserves route arguments, headers and streaming response ownership", async () => {
    const request = new Request("https://test/api/widget/private-id/chat?token=secret", {
      method: "POST", headers: { "x-vercel-id": "iad1::request-a", authorization: "Bearer secret" },
    });
    const params = { assistantId: "private-id" };
    const stream = new ReadableStream();
    const response = new Response(stream, { headers: { "content-type": "application/x-ndjson", "x-custom": "kept" } });
    const handler = vi.fn<(request: Request, routeParams: typeof params) => Promise<Response>>(async () => {
      reportError("runtime.probe", new Error("private data"));
      return response;
    });
    const result = await withRequestDiagnostics("/api/widget/[assistantId]/chat", "widget", handler)(request, params);
    expect(handler).toHaveBeenCalledWith(request, params);
    expect(result).toBe(response);
    expect(result.body).toBe(stream);
    expect(stream.locked).toBe(false);
    expect(result.headers.get("x-custom")).toBe("kept");
    const failures = vi.mocked(console.error).mock.calls;
    expect(JSON.parse(failures[0]![0])).toMatchObject({
      requestId: "iad1::request-a", route: "/api/widget/[assistantId]/chat", surface: "widget",
    });
    expect(JSON.stringify(failures)).not.toContain("secret");
    expect(JSON.stringify(failures)).not.toContain("private-id");
  });

  it("reports handled 4xx and 5xx responses as refusals and failures", async () => {
    const request = new Request("https://test/api/test");
    const denied = Response.json({ error: "denied" }, { status: 403 });
    await expect(withRequestDiagnostics("/api/test", "api", async () => denied)(request)).resolves.toBe(denied);
    expect(JSON.parse(vi.mocked(console.warn).mock.calls[0]![0])).toMatchObject({ status: "rejected", statusCode: 403 });
    const failed = Response.json({ error: "unavailable" }, { status: 503 });
    await expect(withRequestDiagnostics("/api/test", "api", async () => failed)(request)).resolves.toBe(failed);
    expect(JSON.parse(vi.mocked(console.error).mock.calls[0]![0])).toMatchObject({ status: "failed", statusCode: 503 });
  });

  it("propagates the original route failure without disclosing it", async () => {
    const error = new TypeError("token=private");
    await expect(withRequestDiagnostics("/api/test", "api", async () => { throw error; })(new Request("https://test")))
      .rejects.toBe(error);
    const failures = vi.mocked(console.error).mock.calls;
    expect(JSON.parse(failures[0]![0])).toMatchObject({ status: "failed", errorClass: "TypeError" });
    expect(JSON.stringify(failures)).not.toContain("private");
  });
});
