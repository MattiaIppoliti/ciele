import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { ModelRef } from "@agent-hub/core";

const mocks = vi.hoisted(() => ({
  resolveWidgetContext: vi.fn(),
  streamConversationTurn: vi.fn(),
}));

vi.mock("@/lib/widget-db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/widget-db")>();
  return {
    ...actual,
    resolveWidgetContext: mocks.resolveWidgetContext,
    widgetOptions: vi.fn(),
  };
});
vi.mock("@agent-hub/agent", () => ({
  NDJSON_HEADERS: {},
  sessionMetadata: vi.fn(() => ({})),
  streamConversationTurn: mocks.streamConversationTurn,
}));

import { POST } from "./route";

const CONFIGURED: ModelRef = { provider: "google", modelId: "gemini-3.5-flash" };
const SONNET: ModelRef = { provider: "anthropic", modelId: "claude-sonnet-5" };

/**
 * The Publication snapshot is the authority here, not the live Assistant: a
 * widget on a customer's page is served whatever was last published, which is
 * exactly why a selector it no longer recognises has to degrade rather than
 * refuse.
 */
function contextWith(allowedModels: ModelRef[] | undefined) {
  return {
    db: { listProviderConnections: vi.fn().mockResolvedValue([]) },
    assistantId: "a1",
    cors: {},
    publication: {
      createdAt: "2026-01-01T00:00:00Z",
      config: {
        assistant: {
          organizationId: "org-1",
          requireSignIn: false,
          allowedDomains: [],
          modelProvider: CONFIGURED.provider,
          modelId: CONFIGURED.modelId,
          allowedModels,
        },
        collections: [],
        flows: [],
      },
    },
  };
}

function post(body: Record<string, unknown>) {
  return POST(
    new NextRequest("https://ciele.app/api/widget/a1/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ visitorId: "v1", message: "hi", ...body }),
    }),
    { params: Promise.resolve({ assistantId: "a1" }) }
  );
}

/** What the turn was actually handed, which is the only thing that decides. */
function ranWith(): ModelRef {
  const [input] = mocks.streamConversationTurn.mock.calls[0] as [
    { assistant: { modelProvider: string; modelId: string } },
  ];
  return {
    provider: input.assistant.modelProvider as ModelRef["provider"],
    modelId: input.assistant.modelId,
  };
}

describe("widget chat route, per-message model choice", () => {
  beforeEach(() => {
    mocks.resolveWidgetContext.mockReset();
    mocks.streamConversationTurn.mockReset();
    mocks.streamConversationTurn.mockResolvedValue(new ReadableStream());
  });

  it("runs the configured model when the Visitor picked nothing", async () => {
    mocks.resolveWidgetContext.mockResolvedValue(contextWith([SONNET]));
    await post({});
    expect(ranWith()).toEqual(CONFIGURED);
  });

  it("runs the model the Visitor picked, when the snapshot allows it", async () => {
    mocks.resolveWidgetContext.mockResolvedValue(contextWith([SONNET]));
    await post({ model: "anthropic:claude-sonnet-5" });
    expect(ranWith()).toEqual(SONNET);
  });

  // The whole point of the allow-list: a selector is a selection from it, never
  // a way to name a model of one's own.
  it("ignores a model the snapshot never allowed", async () => {
    mocks.resolveWidgetContext.mockResolvedValue(contextWith([SONNET]));
    await post({ model: "openai:gpt-5.1" });
    expect(ranWith()).toEqual(CONFIGURED);
  });

  it("ignores any choice when the allow-list is empty, the default", async () => {
    mocks.resolveWidgetContext.mockResolvedValue(contextWith([]));
    await post({ model: "anthropic:claude-sonnet-5" });
    expect(ranWith()).toEqual(CONFIGURED);
  });

  // Every Publication written before this feature existed has no such key.
  it("answers on a snapshot that predates the allow-list", async () => {
    mocks.resolveWidgetContext.mockResolvedValue(contextWith(undefined));
    await post({ model: "anthropic:claude-sonnet-5" });
    expect(ranWith()).toEqual(CONFIGURED);
  });

  // A stale widget, a garbled body, a client that sends the label instead of
  // the selector: all the same answer, which is an answer.
  it("answers rather than refusing on a malformed selector", async () => {
    for (const model of ["", "anthropic", "::", 42, null, { provider: "x" }]) {
      mocks.streamConversationTurn.mockClear();
      mocks.resolveWidgetContext.mockResolvedValue(contextWith([SONNET]));
      const response = await post({ model });
      expect(response.status).toBe(200);
      expect(ranWith()).toEqual(CONFIGURED);
    }
  });
});
