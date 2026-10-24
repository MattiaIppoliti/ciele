import { createHash, createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getMockDb } from "@agent-hub/db";
import { listAlertsOp, resolveAlertOp } from "./configuration";
import { OperationError, type OperationContext } from "./operation";
import {
  ASSERTION_HEADER,
  createHttpRemoteExecutor,
  registerRemoteExecutor,
  remoteExecutorFor,
  signAssertion,
  type RemoteOperationCall,
} from "./remote";

// Built, not written: the mirror's secret scan reads a literal here as a leaked key.
const SECRET = "s".repeat(32);

function context(overrides: Partial<OperationContext> = {}): OperationContext {
  return {
    organizationId: "org-1",
    userId: "user-1",
    role: "editor",
    db: getMockDb(),
    dbScope: "session",
    ...overrides,
  };
}

afterEach(() => registerRemoteExecutor(null));

describe("forwarding", () => {
  it("sends a listed operation to the executor with the parsed input and the caller", async () => {
    const calls: RemoteOperationCall[] = [];
    registerRemoteExecutor(async (call) => {
      calls.push(call);
      return [{ id: "from-rust" }];
    }, ["alerts.list"]);
    await expect(listAlertsOp.run(context(), {})).resolves.toEqual([{ id: "from-rust" }]);
    expect(calls).toEqual([
      expect.objectContaining({
        operation: "alerts.list",
        organizationId: "org-1",
        userId: "user-1",
        role: "editor",
        dbScope: "session",
        input: {},
      }),
    ]);
  });

  it("keeps an operation the service does not run here, with a warning, instead of failing it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const executor = vi.fn(async () => "remote");
    registerRemoteExecutor(executor, ["alerts.list", "improvements.update", "alerts.lsit"]);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/improvements\.update, alerts\.lsit/));
    await listAlertsOp.run(context(), {});
    expect(executor).toHaveBeenCalledTimes(1);
    expect(remoteExecutorFor("improvements.update", context())).toBeNull();
    warn.mockRestore();
  });

  it("runs here when the operation is not listed, the scope is unknown, or a Teammate or agent acts", async () => {
    const executor = vi.fn(async () => "remote");
    registerRemoteExecutor(executor, ["alerts.list"]);
    const teammate = { id: "t", name: "T", ceiling: "edit" as const, grants: [], approvalBypass: false };
    await expect(resolveAlertOp.run(context(), { id: "missing" })).rejects.toBeInstanceOf(OperationError);
    await listAlertsOp.run(context({ dbScope: undefined }), {});
    await listAlertsOp.run(context({ teammate }), {});
    await listAlertsOp.run(context({ agentAuthor: "Ciele AI" }), {});
    expect(executor).not.toHaveBeenCalled();
  });
});

describe("the HTTP executor", () => {
  const call: RemoteOperationCall = {
    operation: "alerts.resolve",
    organizationId: "org-1",
    userId: "user-1",
    role: "admin",
    dbScope: "pinned",
    input: { id: "a1" },
  };

  it("signs claims the service can verify and binds them to the operation and the body", async () => {
    const body = JSON.stringify(call.input);
    const token = await signAssertion(SECRET, { ...call, actorEmail: "ada@example.edu" }, body, 1_000_000);
    const [payload, signature] = token.split(".");
    expect(createHmac("sha256", SECRET).update(payload!).digest("base64url")).toBe(signature);
    expect(JSON.parse(Buffer.from(payload!, "base64url").toString())).toEqual({
      op: "alerts.resolve",
      org: "org-1",
      sub: "user-1",
      email: "ada@example.edu",
      role: "admin",
      scope: "pinned",
      body: createHash("sha256").update(body).digest("base64url"),
      exp: 1030,
    });
  });

  it("returns the result and posts the input under the operation's path", async () => {
    const fetch = vi.fn(async () => Response.json({ result: { id: "a1", status: "resolved" } }));
    const executor = createHttpRemoteExecutor({ baseUrl: "http://rust:8080/", secret: SECRET, fetch });
    await expect(executor(call)).resolves.toEqual({ id: "a1", status: "resolved" });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://rust:8080/v1/ops/alerts.resolve");
    expect(JSON.parse(init.body as string)).toEqual({ id: "a1" });
    const token = (init.headers as Record<string, string>)[ASSERTION_HEADER]!;
    expect(token).toMatch(/^[\w-]+\.[\w-]+$/);
    // Signed over the very bytes that were sent.
    const claims = JSON.parse(Buffer.from(token.split(".")[0]!, "base64url").toString());
    expect(claims.body).toBe(createHash("sha256").update(init.body as string).digest("base64url"));
  });

  it("turns the operation vocabulary back into an OperationError and anything else into a failure", async () => {
    const answer = (status: number, code: string) =>
      createHttpRemoteExecutor({
        baseUrl: "http://rust",
        secret: SECRET,
        fetch: async () => Response.json({ error: { code, message: "Alert not found" } }, { status }),
      });
    const notFound = await answer(404, "not_found")(call).catch((error: unknown) => error);
    expect(notFound).toBeInstanceOf(OperationError);
    expect((notFound as OperationError).code).toBe("not_found");
    await expect(answer(401, "unauthorized")(call)).rejects.not.toBeInstanceOf(OperationError);
    await expect(answer(500, "internal")(call)).rejects.toThrow(/alerts\.resolve failed: 500/);
  });
});
