import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Flow } from "@agent-hub/core";

const mocks = vi.hoisted(() => ({
  resolveApiKeyContext: vi.fn(),
  getLatestPublicationCached: vi.fn(),
  runHttpFlow: vi.fn(),
}));

vi.mock("@/lib/api-v1/auth", () => ({ resolveApiKeyContext: mocks.resolveApiKeyContext }));
vi.mock("@/lib/widget-db", () => ({ getLatestPublicationCached: mocks.getLatestPublicationCached }));
vi.mock("@/lib/runtime-db", () => ({ getRuntimeDb: (db: unknown) => db }));
vi.mock("@agent-hub/agent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-hub/agent")>()),
  runHttpFlow: mocks.runHttpFlow,
}));

import { POST } from "./route";

/**
 * The inbound trigger route (#843). What it decides before any action runs:
 * who may call (a key of the Organization), which Flow runs (the published
 * one), and how fast (per key).
 */
const flow = (over: Partial<Flow> = {}): Flow =>
  ({
    id: "f1",
    assistantId: "a1",
    name: "Order status",
    trigger: "http_request",
    triggerSettings: {},
    enabled: true,
    isDefault: false,
    position: 0,
    actions: ["respond"],
    actionSettings: { respond: { status: 200 } },
    conditions: [],
    conditionLogic: "all",
    ...over,
  }) as Flow;

function keyContext(live: Flow | null, keyId = "key-1") {
  return {
    organizationId: "org-1",
    role: "viewer",
    keyId,
    actorUserId: "u1",
    db: {
      getFlow: async () => live,
      getAssistant: async () => ({ id: "a1", organizationId: "org-1" }),
    },
  };
}

function call(flowId = "f1") {
  return POST(
    new NextRequest(`https://ciele.example/api/flows/${flowId}/trigger`, {
      method: "POST",
      body: '{"orderId":"A-1"}',
      headers: { authorization: "Bearer ciele_sk_test", "content-type": "application/json" },
    }),
    { params: Promise.resolve({ flowId }) }
  );
}

describe("the inbound flow trigger route", () => {
  beforeEach(() => {
    mocks.resolveApiKeyContext.mockReset();
    mocks.getLatestPublicationCached.mockReset();
    mocks.runHttpFlow.mockReset();
    mocks.runHttpFlow.mockResolvedValue({
      status: 200,
      headers: { "x-order-state": "shipped" },
      body: '{"ok":true}',
      ran: ["respond"],
      failed: null,
    });
  });

  it("refuses without a key before touching anything", async () => {
    mocks.resolveApiKeyContext.mockResolvedValue(new Response("nope", { status: 401 }));
    expect((await call()).status).toBe(401);
    expect(mocks.getLatestPublicationCached).not.toHaveBeenCalled();
    expect(mocks.runHttpFlow).not.toHaveBeenCalled();
  });

  it("runs the published Flow, names the Publication, and sends back what it answered", async () => {
    mocks.resolveApiKeyContext.mockResolvedValue(keyContext(flow()));
    mocks.getLatestPublicationCached.mockResolvedValue({
      id: "pub-9",
      config: { flows: [flow({ name: "Published copy" })] },
    });
    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get("x-order-state")).toBe("shipped");
    expect(await response.text()).toBe('{"ok":true}');
    const args = mocks.runHttpFlow.mock.calls[0]![0] as { flow: Flow; publicationId: string };
    expect(args.flow.name).toBe("Published copy");
    expect(args.publicationId).toBe("pub-9");
  });

  it("answers not_published for a saved Flow the assistant has not published", async () => {
    mocks.resolveApiKeyContext.mockResolvedValue(keyContext(flow()));
    mocks.getLatestPublicationCached.mockResolvedValue({ id: "pub-1", config: { flows: [] } });
    const response = await call();
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "not_published" } });
    expect(mocks.runHttpFlow).not.toHaveBeenCalled();
  });

  it("answers not_found for a Flow the key's Organization cannot see, and for a chat Flow", async () => {
    mocks.resolveApiKeyContext.mockResolvedValue(keyContext(null));
    expect((await call("someone-elses")).status).toBe(404);
    mocks.resolveApiKeyContext.mockResolvedValue(keyContext(flow({ trigger: "message" })));
    mocks.getLatestPublicationCached.mockResolvedValue({
      id: "pub-1",
      config: { flows: [flow({ trigger: "message" })] },
    });
    expect((await call()).status).toBe(404);
    expect(mocks.runHttpFlow).not.toHaveBeenCalled();
  });

  it("rate-limits per key", async () => {
    mocks.resolveApiKeyContext.mockResolvedValue(keyContext(flow(), "key-limited"));
    mocks.getLatestPublicationCached.mockResolvedValue({ id: "pub-1", config: { flows: [flow()] } });
    let limited: Response | null = null;
    for (let i = 0; i < 61; i += 1) {
      const response = await call();
      if (response.status === 429) {
        limited = response;
        break;
      }
    }
    expect(limited?.status).toBe(429);
  });
});
