import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./egress", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./egress")>()),
  egressFetch: vi.fn(),
}));

import type { Assistant, Flow, FlowActionSettings } from "@agent-hub/core";
import { egressFetch } from "./egress";
import { ACTION_HANDLERS } from "./actions";
import { refuseHttpFlow, runHttpFlow } from "./http-flow-run";
import type { Db } from "@agent-hub/db";

/**
 * A Flow another system calls (#843). The route's whole job is to decide
 * whether to run one and to send back what it answered, so these are the two
 * halves of that: the refusals that happen before any action runs, and what a
 * run gives the caller.
 */

const egressFetchMock = vi.mocked(egressFetch);

function ok(text: string, status = 200) {
  return {
    response: { status, ok: status >= 200 && status < 300, headers: new Headers(), text },
    finalUrl: "https://api.example.com/",
  };
}

const assistant = { id: "a1", organizationId: "org1" } as Assistant;

const flow = (
  actions: Flow["actions"],
  actionSettings: FlowActionSettings = {},
  over: Partial<Flow> = {}
): Flow =>
  ({
    id: "f1",
    assistantId: "a1",
    name: "Order status",
    trigger: "http_request",
    triggerSettings: {},
    enabled: true,
    isDefault: false,
    position: 0,
    actions,
    actionSettings,
    conditions: [],
    conditionLogic: "all",
    ...over,
  }) as Flow;

const request = {
  method: "POST",
  body: '{"orderId":"A-1"}',
  query: {},
  headers: { authorization: "Bearer sk-live-secret" },
};

/** A Db with the two things a run writes: its record and any Improvement. */
function fakeDb() {
  const runs: Record<string, unknown>[] = [];
  const improvements: { title: string }[] = [];
  const db = {
    table: (name: string) => {
      if (name !== "httpFlowRuns") throw new Error(`unexpected table ${name}`);
      return { insert: async (row: Record<string, unknown>) => (runs.push(row), { id: "r1", ...row }) };
    },
    createImprovement: async (_org: string, input: { title: string }) => {
      improvements.push(input);
      return { id: "imp-1", ...input };
    },
    getApplicationConnection: async () => null,
  } as unknown as Db;
  return { db, runs, improvements };
}

const run = (f: Flow, db: Db = fakeDb().db) =>
  runHttpFlow({
    db,
    assistant,
    flow: f,
    request,
    publicationId: "pub-1",
  });

describe("deciding whether to run at all", () => {
  it("refuses a Flow that is missing, off, or not an inbound one", () => {
    expect(refuseHttpFlow(null, "POST")).toEqual({ reason: "not_found" });
    // Disabled reads differently from missing on purpose: an Editor who turned
    // a Flow off should not be told their URL is wrong.
    expect(refuseHttpFlow(flow([], {}, { enabled: false }), "POST")).toEqual({
      reason: "disabled",
    });
    expect(refuseHttpFlow(flow([], {}, { trigger: "message" }), "POST")).toEqual({
      reason: "wrong_trigger",
    });
  });

  it("refuses a method the Flow does not accept, and says which it does", () => {
    const only = flow([], {}, { triggerSettings: { httpRequest: { methods: ["POST"] } } });
    expect(refuseHttpFlow(only, "DELETE")).toEqual({
      reason: "method_not_allowed",
      allowed: ["POST"],
    });
    expect(refuseHttpFlow(only, "post")).toBeNull();
  });

  it("defaults to POST only", () => {
    expect(refuseHttpFlow(flow([]), "GET")).toMatchObject({ reason: "method_not_allowed" });
    expect(refuseHttpFlow(flow([]), "POST")).toBeNull();
  });
});

describe("what the caller gets back", () => {
  beforeEach(() => {
    egressFetchMock.mockReset();
    egressFetchMock.mockResolvedValue(ok("{}") as never);
  });

  it("sends the Response action's status, headers and body", async () => {
    const result = await run(
      flow(["respond"], {
        respond: {
          status: 202,
          headers: [{ id: "h1", name: "X-Order-State", value: "queued" }],
          bodyTemplate: '{"ok":true}',
        },
      })
    );
    expect(result.status).toBe(202);
    expect(result.headers).toEqual({ "x-order-state": "queued" });
    expect(result.body).toBe('{"ok":true}');
  });

  it("answers 204 when the Flow did its work and said nothing", async () => {
    const result = await run(
      flow(["api_request"], {
        api_request: { method: "POST", url: "https://api.example.com/orders" },
      })
    );
    expect(result.status).toBe(204);
    expect(result.body).toBe("");
    expect(result.ran).toEqual(["api_request"]);
  });

  it("stops at the Response: nothing after it can change what was sent", async () => {
    const result = await run(
      flow(["respond", "api_request"], {
        respond: { status: 200 },
        api_request: { method: "POST", url: "https://api.example.com/orders" },
      })
    );
    expect(result.ran).toEqual(["respond"]);
    expect(egressFetchMock).not.toHaveBeenCalled();
  });

  it("resolves template variables from the request in the response body", async () => {
    const result = await run(
      flow(["respond"], {
        respond: { status: 200, bodyTemplate: '{"echo":"{{request.method}}","id":"{{request.body.orderId}}"}' },
      })
    );
    expect(result.body).toBe('{"echo":"POST","id":"A-1"}');
  });

  it("answers 500 and says so when the Response never chose a status", async () => {
    // A snapshot older than the required-status rule: the caller must not be
    // handed a 200 the author never configured.
    const result = await run(flow(["respond"], { respond: { bodyTemplate: "{}" } }));
    expect(result.status).toBe(500);
    expect(result.body).toContain("respond_not_configured");
  });

  it("records the run: what ran, what was answered, how long, and which action failed", async () => {
    const { db, runs } = fakeDb();
    egressFetchMock.mockResolvedValueOnce(ok("{}") as never);
    await run(
      flow(["api_request", "respond"], {
        api_request: { method: "POST", url: "https://api.example.com/orders" },
        respond: { status: 201 },
      }),
      db
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      organizationId: "org1",
      assistantId: "a1",
      flowId: "f1",
      publicationId: "pub-1",
      method: "POST",
      status: 201,
      ran: ["api_request", "respond"],
      failedAction: null,
    });
    // The record keeps neither body: a caller's data is not ours to archive.
    expect(JSON.stringify(runs[0])).not.toContain("A-1");
  });

  it("files the Improvement the effect asked for, with no Conversation to link it to", async () => {
    // The handler titles the item after the triggering message, which for an
    // inbound run is the request body; there is no message to link it to.
    const { db, improvements } = fakeDb();
    const result = await run(
      flow(["improvement", "respond"], { respond: { status: 200 } }),
      db
    );
    expect(result.status).toBe(200);
    expect(improvements).toEqual([
      expect.objectContaining({ title: 'Review: {"orderId":"A-1"}', messageId: null }),
    ]);
  });

  it("gives a Connector step a runtime, so it is not refused as unavailable", async () => {
    // The Connection read returns nothing here, so the step reports a missing
    // connection: the point is that it got as far as looking, which the old
    // context (no runtime at all) never did.
    const result = await run(
      flow(["connector", "respond"], {
        connector: { action: "slack.message.post", connectionId: "conn-1", params: { channel: "C1", text: "x" } },
        respond: { status: 200, bodyTemplate: '{"ok":"{{connector.ok}}"}' },
      })
    );
    expect(result.body).toBe('{"ok":"false"}');
    expect(result.ran).toEqual(["connector", "respond"]);
  });

  it("passes an earlier action's extracted values to the Response", async () => {
    // The point of the trigger: call out, then answer with what came back.
    egressFetchMock.mockResolvedValueOnce(ok('{"data":{"state":"shipped"}}') as never);
    const result = await run(
      flow(["api_request", "respond"], {
        api_request: {
          method: "GET",
          url: "https://api.example.com/orders/1",
          jsonPaths: [{ id: "j1", path: "$.data.state", variable: "state" }],
        },
        respond: { status: 200, bodyTemplate: '{"state":"{{state}}"}' },
      })
    );
    expect(result.body).toBe('{"state":"shipped"}');
  });

  it("never lets the Flow read the credential the caller authenticated with", async () => {
    const result = await run(
      flow(["respond"], {
        respond: { status: 200, bodyTemplate: '{"leak":"{{request.header.authorization}}"}' },
      })
    );
    expect(result.body).not.toContain("sk-live-secret");
  });

  it("skips an action this trigger may not run, rather than running it", async () => {
    // A Flow whose trigger was changed after it was written: the save-time gate
    // is the first of two, and this is the second.
    const result = await run(
      flow(["custom_message", "respond"], { respond: { status: 200 } })
    );
    expect(result.ran).toEqual(["respond"]);
  });

  it("still answers when an outbound call fails, because the caller is waiting either way", async () => {
    // `api_request` reports its own failure rather than throwing; the Response
    // after it is what the caller reads, and it must still be sent.
    egressFetchMock.mockRejectedValueOnce(new Error("network"));
    const result = await run(
      flow(["api_request", "respond"], {
        api_request: { method: "POST", url: "https://api.example.com/orders" },
        respond: { status: 200, bodyTemplate: '{"received":true}' },
      })
    );
    expect(result.status).toBe(200);
    expect(result.body).toBe('{"received":true}');
  });

  it("answers 500 when an action threw before the Flow could answer", async () => {
    // Nothing in the inbound catalogue throws today, so the branch is reached
    // the only honest way: by making one throw. A 204 here would tell a caller
    // its request completed when it did not.
    const original = ACTION_HANDLERS.improvement;
    ACTION_HANDLERS.improvement = () => {
      throw new Error("boom");
    };
    try {
      const result = await run(flow(["improvement", "respond"], { respond: { status: 200 } }));
      expect(result.status).toBe(500);
      expect(result.failed).toEqual({ action: "improvement", message: "boom" });
      expect(result.ran).toEqual(["improvement"]);
    } finally {
      ACTION_HANDLERS.improvement = original;
    }
  });
});
