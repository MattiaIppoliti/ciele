import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  resolveWidgetContext: vi.fn(),
}));

// Keep the real widgetSubject — the gate-to-subject resolution is exactly
// what the Memory folder's access control rides on (#666).
vi.mock("@/lib/widget-db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/widget-db")>();
  return {
    ...actual,
    resolveWidgetContext: mocks.resolveWidgetContext,
    widgetOptions: vi.fn(),
  };
});

import { DELETE, GET } from "./route";
import { SSO_GATE_COOKIE, sealGate } from "@/lib/sso";

const ORG = "org-1";
const SUBJECT = "entra-sub-1";

function makeDb() {
  return {
    getMemoryEnabled: vi.fn().mockResolvedValue(true),
    listMemories: vi.fn().mockResolvedValue([
      {
        id: "m1",
        organizationId: ORG,
        subjectId: SUBJECT,
        text: "Prefers pickup",
        conversationId: null,
        createdAt: "2026-01-01T00:00:00Z",
      },
    ]),
    deleteMemory: vi.fn().mockResolvedValue(undefined),
  };
}

function contextWith(db: ReturnType<typeof makeDb>) {
  return {
    db,
    assistantId: "a1",
    cors: {},
    publication: {
      config: {
        assistant: { organizationId: ORG, allowedDomains: [] },
        collections: [],
        flows: [],
      },
    },
  };
}

function gateCookie(subjectId = SUBJECT, organizationId = ORG) {
  return `${SSO_GATE_COOKIE}=${sealGate({
    organizationId,
    subjectId,
    provider: "entra",
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}`;
}

function get(cookie?: string) {
  return GET(
    new NextRequest("https://platform.ciele.app/api/widget/a1/memories", {
      headers: cookie ? { cookie } : {},
    }),
    { params: Promise.resolve({ assistantId: "a1" }) }
  );
}

function del(cookie: string | undefined, id: string) {
  return DELETE(
    new NextRequest(
      `https://platform.ciele.app/api/widget/a1/memories?id=${id}`,
      { method: "DELETE", headers: cookie ? { cookie } : {} }
    ),
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

describe("widget memories route (#666)", () => {
  let db: ReturnType<typeof makeDb>;
  beforeEach(() => {
    db = makeDb();
    mocks.resolveWidgetContext.mockReset();
    mocks.resolveWidgetContext.mockResolvedValue(contextWith(db));
  });

  it("404s anonymous visitors — no gate, no folder", async () => {
    expect((await get(undefined)).status).toBe(404);
    expect(db.listMemories).not.toHaveBeenCalled();
  });

  it("404s a gate minted for a different organization", async () => {
    expect((await get(gateCookie(SUBJECT, "org-2"))).status).toBe(404);
    expect(db.listMemories).not.toHaveBeenCalled();
  });

  it("404s when the org memory toggle is off", async () => {
    db.getMemoryEnabled.mockResolvedValue(false);
    expect((await get(gateCookie())).status).toBe(404);
    expect(db.listMemories).not.toHaveBeenCalled();
  });

  it("lists only the verified subject's memories", async () => {
    const res = await get(gateCookie());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      memories: [
        { id: "m1", text: "Prefers pickup", createdAt: "2026-01-01T00:00:00Z" },
      ],
    });
    expect(db.listMemories).toHaveBeenCalledWith({
      organizationId: ORG,
      subjectId: SUBJECT,
    });
  });

  it("deletes a memory the subject owns", async () => {
    const res = await del(gateCookie(), "m1");
    expect(res.status).toBe(200);
    expect(db.deleteMemory).toHaveBeenCalledWith("m1");
  });

  it("refuses to delete a memory that is not the subject's own", async () => {
    const res = await del(gateCookie(), "someone-elses");
    expect(res.status).toBe(404);
    expect(db.deleteMemory).not.toHaveBeenCalled();
  });

  it("404s deletes from anonymous visitors", async () => {
    expect((await del(undefined, "m1")).status).toBe(404);
    expect(db.deleteMemory).not.toHaveBeenCalled();
  });
});
