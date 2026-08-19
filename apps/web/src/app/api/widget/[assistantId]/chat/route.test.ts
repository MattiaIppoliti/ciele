import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  resolveWidgetContext: vi.fn(),
  streamConversationTurn: vi.fn(),
}));

// Keep the real widgetSubject/subjectOwnsConversation, the gate-to-subject
// resolution (#662) is exactly what these tests exercise.
vi.mock("@/lib/widget-db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/widget-db")>();
  return {
    ...actual,
    resolveWidgetContext: mocks.resolveWidgetContext,
    widgetOptions: vi.fn(),
  };
});
// The turn machinery is irrelevant to the gate check (which runs first).
vi.mock("@agent-hub/agent", () => ({
  NDJSON_HEADERS: {},
  sessionMetadata: vi.fn(() => ({})),
  streamConversationTurn: mocks.streamConversationTurn,
}));

import { sessionMetadata } from "@agent-hub/agent";
import { POST } from "./route";
import { SSO_GATE_COOKIE, sealGate } from "@/lib/sso";

const ORG = "org-1";

function contextWith(requireSignIn: boolean) {
  return {
    db: { listProviderConnections: vi.fn().mockResolvedValue([]) },
    assistantId: "a1",
    cors: {},
    publication: {
      createdAt: "2026-01-01T00:00:00Z",
      config: {
        assistant: {
          organizationId: ORG,
          requireSignIn,
          allowedDomains: [],
        },
        collections: [],
        flows: [],
      },
    },
  };
}

function post(cookie?: string, body: unknown = {}) {
  return POST(
    new NextRequest("https://platform.ciele.app/api/widget/a1/chat", {
      method: "POST",
      headers: cookie
        ? { cookie, "content-type": "application/json" }
        : { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ assistantId: "a1" }) }
  );
}

const priorKey = process.env.APP_ENCRYPTION_KEY;
beforeAll(() => {
  process.env.APP_ENCRYPTION_KEY = "test-encryption-key";
});
afterAll(() => {
  if (priorKey === undefined) delete process.env.APP_ENCRYPTION_KEY;
  else process.env.APP_ENCRYPTION_KEY = priorKey;
});

describe("widget chat route, SSO gate enforcement", () => {
  beforeEach(() => {
    mocks.resolveWidgetContext.mockReset();
    mocks.streamConversationTurn.mockReset();
  });

  it("401s an enforced assistant when no gate cookie is present", async () => {
    mocks.resolveWidgetContext.mockResolvedValue(contextWith(true));
    const res = await post(undefined, { visitorId: "v1", message: "hi" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "sign_in_required" });
  });

  it("401s an enforced assistant with a gate cookie for a different org", async () => {
    mocks.resolveWidgetContext.mockResolvedValue(contextWith(true));
    const otherOrgGate = sealGate({
      organizationId: "org-2",
      subjectId: "s",
      provider: "entra",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const res = await post(`${SSO_GATE_COOKIE}=${otherOrgGate}`, {
      visitorId: "v1",
      message: "hi",
    });
    expect(res.status).toBe(401);
  });

  it("passes the gate with a valid cookie (then fails validation, not 401)", async () => {
    mocks.resolveWidgetContext.mockResolvedValue(contextWith(true));
    const gate = sealGate({
      organizationId: ORG,
      subjectId: "s",
      provider: "entra",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    // Empty body → the handler proceeds past the gate to body validation (400).
    const res = await post(`${SSO_GATE_COOKIE}=${gate}`, {});
    expect(res.status).toBe(400);
  });

  it("does not gate an assistant that doesn't require sign-in", async () => {
    mocks.resolveWidgetContext.mockResolvedValue(contextWith(false));
    const res = await post(undefined, {});
    expect(res.status).toBe(400); // reaches body validation, never 401
  });

  it("401s an enforced assistant even on a malformed body (gate precedes parse)", async () => {
    mocks.resolveWidgetContext.mockResolvedValue(contextWith(true));
    const res = await POST(
      new NextRequest("https://platform.ciele.app/api/widget/a1/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not json",
      }),
      { params: Promise.resolve({ assistantId: "a1" }) }
    );
    expect(res.status).toBe(401);
  });

  it("400s a malformed body on an open assistant instead of throwing", async () => {
    mocks.resolveWidgetContext.mockResolvedValue(contextWith(false));
    const res = await POST(
      new NextRequest("https://platform.ciele.app/api/widget/a1/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not json",
      }),
      { params: Promise.resolve({ assistantId: "a1" }) }
    );
    expect(res.status).toBe(400);
  });

  it("threads the verified subject + claim into the turn (#662)", async () => {
    mocks.resolveWidgetContext.mockResolvedValue(contextWith(true));
    mocks.streamConversationTurn.mockResolvedValue(new ReadableStream());
    const gate = sealGate({
      organizationId: ORG,
      subjectId: "entra-sub-9",
      provider: "entra",
      claim: { name: "email", value: "person@example.com" },
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const res = await post(`${SSO_GATE_COOKIE}=${gate}`, {
      visitorId: "v1",
      message: "hi",
    });
    expect(res.status).toBe(200);
    const input = mocks.streamConversationTurn.mock.calls[0][0];
    // The gate's verified subject replaces the client-supplied visitor id.
    expect(input.subjectType).toBe("sso");
    expect(input.subjectId).toBe("entra-sub-9");
    expect(input.verifiedIdentity).toEqual({
      subjectId: "entra-sub-9",
      claim: { name: "email", value: "person@example.com" },
    });
    expect(input.metadata.ssoClaimValue).toBe("person@example.com");
    expect(input.metadata.userEmail).toBe("person@example.com");
  });

  it("keeps anonymous traffic on the visitor subject", async () => {
    mocks.resolveWidgetContext.mockResolvedValue(contextWith(false));
    mocks.streamConversationTurn.mockResolvedValue(new ReadableStream());
    const res = await post(undefined, { visitorId: "v1", message: "hi" });
    expect(res.status).toBe(200);
    const input = mocks.streamConversationTurn.mock.calls[0][0];
    expect(input.subjectType).toBe("visitor");
    expect(input.subjectId).toBe("v1");
    expect(input.verifiedIdentity).toBeUndefined();
  });
});

/**
 * The embedding page the launcher forwards. Without it, URL Flow Conditions
 * would be evaluated against the chat iframe's own origin (spec #550).
 */
describe("widget chat route, reported page URL", () => {
  beforeEach(() => {
    mocks.resolveWidgetContext.mockReset();
    vi.mocked(sessionMetadata).mockClear();
  });

  it("hands the body's pageUrl to sessionMetadata", async () => {
    mocks.resolveWidgetContext.mockResolvedValue(contextWith(false));
    await post(undefined, {
      visitorId: "v1",
      message: "hi",
      pageUrl: "https://campus.edu/courses/psychology",
    });
    expect(sessionMetadata).toHaveBeenCalledWith(
      expect.anything(),
      "https://campus.edu/courses/psychology"
    );
  });

  it("passes undefined when the embed reported nothing", async () => {
    mocks.resolveWidgetContext.mockResolvedValue(contextWith(false));
    await post(undefined, { visitorId: "v1", message: "hi", pageUrl: null });
    expect(sessionMetadata).toHaveBeenCalledWith(expect.anything(), undefined);
  });
});
