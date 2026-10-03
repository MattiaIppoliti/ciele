import { afterEach, describe, expect, it, vi } from "vitest";
import { observe, reportError, requestIdFromHeaders, withDiagnosticContext } from "./index";

afterEach(() => vi.restoreAllMocks());

describe("operation diagnostics", () => {
  it("returns the original result and reports one completed lifecycle", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = { id: "created", privateBody: "not for logs" };
    await expect(observe({ name: "operation", context: { operation: "assistants.create" } }, async () => result))
      .resolves.toBe(result);

    expect(log).toHaveBeenCalledTimes(2);
    expect(JSON.parse(log.mock.calls[0]![0])).toMatchObject({
      event: "operation", status: "started", operation: "assistants.create", level: "info",
    });
    expect(JSON.parse(log.mock.calls[1]![0])).toMatchObject({
      event: "operation", status: "succeeded", durationMs: expect.any(Number),
      traceId: expect.stringMatching(/^[a-f0-9]{32}$/),
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("not for logs");
  });

  it("preserves the original thrown value and excludes error contents", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new TypeError("Bearer secret and private student text");
    await expect(observe({ name: "operation" }, () => { throw error; })).rejects.toBe(error);
    expect(log).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalledTimes(1);
    expect(JSON.parse(errors.mock.calls[0]![0])).toMatchObject({ status: "failed", errorClass: "TypeError" });
    expect(JSON.stringify(errors.mock.calls)).not.toContain("secret");
    expect(JSON.stringify(errors.mock.calls)).not.toContain("student");
  });

  it("isolates overlapping tenants and restores the parent's context", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const first = observe({ name: "first", context: { organizationId: "org-a", requestId: "request-a" } }, async () => {
      await blocked;
      reportError("first.failure", new Error("private"));
    });
    await observe({ name: "second", context: { organizationId: "org-b", requestId: "request-b" } }, async () => {
      await Promise.resolve();
      reportError("second.failure", new Error("private"));
    });
    release();
    await first;
    const records = [...log.mock.calls, ...errors.mock.calls].map(([record]) => JSON.parse(record));
    for (const record of records) {
      const isFirst = record.event.startsWith("first");
      expect(record.organizationId).toBe(isFirst ? "org-a" : "org-b");
      expect(record.requestId).toBe(isFirst ? "request-a" : "request-b");
    }
    expect(new Set(records.filter((r) => r.organizationId === "org-a").map((r) => r.traceId)).size).toBe(1);
    expect(new Set(records.filter((r) => r.organizationId === "org-b").map((r) => r.traceId)).size).toBe(1);
    expect(records.find((r) => r.organizationId === "org-a").traceId)
      .not.toBe(records.find((r) => r.organizationId === "org-b").traceId);

    await withDiagnosticContext({ organizationId: "parent" }, async () => {
      await observe({ name: "nested", context: { organizationId: "child" } }, async () => null);
      reportError("parent.failure", undefined);
    });
    expect(JSON.parse(errors.mock.calls.at(-1)![0])).toMatchObject({ organizationId: "parent" });
    reportError("outside.failure", undefined);
    expect(JSON.parse(errors.mock.calls.at(-1)![0])).not.toHaveProperty("organizationId");
  });

  it("rejects extra metadata and unsafe identifiers at runtime", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const context = {
      organizationId: "org-safe", requestId: "https://example.test/?token=secret",
      operation: "assistants.create", body: "student text", authorization: "Bearer secret",
      count: Infinity,
    };
    reportError("sink.failure", new Error("secret"), context);
    const record = JSON.parse(errors.mock.calls[0]![0]);
    expect(record).toMatchObject({ organizationId: "org-safe", operation: "assistants.create" });
    expect(record).not.toHaveProperty("body");
    expect(record).not.toHaveProperty("authorization");
    expect(record).not.toHaveProperty("requestId");
    expect(record).not.toHaveProperty("count");
    expect(JSON.stringify(record)).not.toContain("secret");
  });

  it("keeps inherited identifiers when a local override is absent or unsafe", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    withDiagnosticContext({ traceId: "trace-parent", requestId: "request-parent", organizationId: "org-parent" }, () => {
      reportError("sink.failure", new Error("private"), {
        traceId: undefined, requestId: "https://test/?token=secret", organizationId: "org-child",
      });
    });
    expect(JSON.parse(errors.mock.calls[0]![0])).toMatchObject({
      traceId: "trace-parent", requestId: "request-parent", organizationId: "org-child",
    });
    expect(JSON.stringify(errors.mock.calls)).not.toContain("secret");
  });

  it("cannot fail completed work or replace an exception when the sink fails", async () => {
    for (const method of ["log", "warn", "error"] as const) {
      vi.spyOn(console, method).mockImplementation(() => { throw new Error("sink down"); });
    }
    const response = Response.json({ ok: true });
    await expect(observe({ name: "request", outcome: () => ({ status: "rejected" }) }, async () => response))
      .resolves.toBe(response);
    const error = { privateMessage: "original failure" };
    await expect(observe({ name: "operation" }, async () => { throw error; })).rejects.toBe(error);
    await expect(observe({ name: "operation", outcome: () => { throw new Error("observer down"); } }, async () => 42))
      .resolves.toBe(42);
    expect(() => reportError("sink.failure", error)).not.toThrow();
  });

  it("reports returned failures and retries without changing the result", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(observe({ name: "request", outcome: () => ({ status: "failed", statusCode: 503 }) }, async () => 503))
      .resolves.toBe(503);
    expect(JSON.parse(errors.mock.calls[0]![0])).toMatchObject({ status: "failed", statusCode: 503 });
    await expect(observe({ name: "job", outcome: () => ({ status: "retried" }) }, async () => "retried"))
      .resolves.toBe("retried");
    expect(JSON.parse(warnings.mock.calls[0]![0])).toMatchObject({ status: "retried" });
  });

  it("uses bounded correlation headers and creates one when absent or invalid", () => {
    expect(requestIdFromHeaders(new Headers({ "x-vercel-id": "iad1::request-a", "x-request-id": "request-b" })))
      .toBe("iad1::request-a");
    expect(requestIdFromHeaders(new Headers({ "x-vercel-id": "x".repeat(201), "x-request-id": "request-b" })))
      .toBe("request-b");
    expect(requestIdFromHeaders(new Headers({ "x-request-id": "https://test/?secret=token" })))
      .toMatch(/^[a-f0-9-]{36}$/);
    expect(requestIdFromHeaders(new Headers())).toMatch(/^[a-f0-9-]{36}$/);
    withDiagnosticContext({ requestId: "inherited-request" }, () => {
      expect(requestIdFromHeaders(new Headers())).toBe("inherited-request");
    });
  });
});
