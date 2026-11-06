import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  resolveWidgetContext: vi.fn(),
}));

// Keep the real widgetSubject and subjectOwnsConversation: who a request
// speaks for, and whether that subject owns the Conversation, are the rule
// this route enforces (#1137).
vi.mock("@/lib/widget-db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/widget-db")>();
  return { ...actual, resolveWidgetContext: mocks.resolveWidgetContext };
});

import { POST } from "./route";
import { SSO_GATE_COOKIE, sealGate } from "@/lib/sso";

/**
 * Rating an answer (#1137, the fix in d850f303). The route used to update any
 * message by id with the service role. It now answers 404 unless the message
 * sits in a Conversation that this subject started with this Assistant. The
 * widget parity test covers this too, but it skips without the Rust binary;
 * this runs everywhere.
 */

const ORG = "org-1";
const ASSISTANT = "a1";

function conversation(overrides: Partial<Record<string, string>> = {}) {
  return {
    id: "c1",
    assistantId: ASSISTANT,
    subjectType: "visitor",
    subjectId: "visitor-1",
    ...overrides,
  };
}

function makeDb() {
  return {
    getConversationForMessage: vi.fn().mockResolvedValue(conversation()),
    setMessageFeedback: vi.fn().mockResolvedValue(undefined),
  };
}

function contextWith(db: ReturnType<typeof makeDb>) {
  return {
    db,
    assistantId: ASSISTANT,
    cors: {},
    publication: { config: { assistant: { organizationId: ORG, allowedDomains: [] } } },
  };
}

function rate(body: Record<string, unknown>, cookie?: string) {
  return POST(
    new NextRequest(`https://ciele.app/api/widget/${ASSISTANT}/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ assistantId: ASSISTANT }) }
  );
}

function gateCookie(subjectId: string) {
  return `${SSO_GATE_COOKIE}=${sealGate({
    organizationId: ORG,
    subjectId,
    provider: "entra",
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}`;
}

const priorKey = process.env.APP_ENCRYPTION_KEY;
beforeAll(() => {
  process.env.APP_ENCRYPTION_KEY = "test-encryption-key";
});
afterAll(() => {
  if (priorKey === undefined) delete process.env.APP_ENCRYPTION_KEY;
  else process.env.APP_ENCRYPTION_KEY = priorKey;
});

describe("POST /api/widget/{assistantId}/feedback", () => {
  let db: ReturnType<typeof makeDb>;
  beforeEach(() => {
    db = makeDb();
    mocks.resolveWidgetContext.mockReset();
    mocks.resolveWidgetContext.mockResolvedValue(contextWith(db));
  });

  it("rates an answer in the Visitor's own Conversation", async () => {
    const response = await rate({ messageId: "m1", visitorId: "visitor-1", feedback: 1 });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(db.setMessageFeedback).toHaveBeenCalledWith("m1", 1, null);
  });

  it("refuses, with 404 and no write, a message in another Visitor's Conversation", async () => {
    const response = await rate({ messageId: "m1", visitorId: "visitor-2", feedback: -1 });
    expect(response.status).toBe(404);
    expect(db.setMessageFeedback).not.toHaveBeenCalled();
  });

  it("refuses a message in a Conversation of another Assistant", async () => {
    db.getConversationForMessage.mockResolvedValue(conversation({ assistantId: "a2" }));
    expect((await rate({ messageId: "m1", visitorId: "visitor-1", feedback: 1 })).status).toBe(404);
    expect(db.setMessageFeedback).not.toHaveBeenCalled();
  });

  it("refuses a message id that names no Conversation", async () => {
    db.getConversationForMessage.mockResolvedValue(null);
    expect((await rate({ messageId: "nope", visitorId: "visitor-1", feedback: 1 })).status).toBe(404);
    expect(db.setMessageFeedback).not.toHaveBeenCalled();
  });

  it("refuses an anonymous Visitor's claim on a signed-in subject's Conversation", async () => {
    db.getConversationForMessage.mockResolvedValue(conversation({ subjectType: "sso", subjectId: "entra-1" }));
    // The Visitor id equals the SSO subject id, but the types differ.
    expect((await rate({ messageId: "m1", visitorId: "entra-1", feedback: 1 })).status).toBe(404);
    expect(db.setMessageFeedback).not.toHaveBeenCalled();
    // With the gate, the same subject rates its own answer.
    expect((await rate({ messageId: "m1", feedback: 1 }, gateCookie("entra-1"))).status).toBe(200);
  });

  it("answers 400 without a visitorId and no gate, before it reads the message", async () => {
    const response = await rate({ messageId: "m1", feedback: 1 });
    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Bad request");
    expect(db.getConversationForMessage).not.toHaveBeenCalled();
    expect(db.setMessageFeedback).not.toHaveBeenCalled();
    expect((await rate({ messageId: "m1", visitorId: "", feedback: 1 })).status).toBe(400);
  });

  it("answers 400 for a missing message id or a score out of range", async () => {
    expect((await rate({ visitorId: "visitor-1", feedback: 1 })).status).toBe(400);
    expect((await rate({ messageId: "m1", visitorId: "visitor-1", feedback: 2 })).status).toBe(400);
    expect((await rate({ messageId: "m1", visitorId: "visitor-1", reaction: "nope" })).status).toBe(400);
    expect(db.setMessageFeedback).not.toHaveBeenCalled();
  });
});
