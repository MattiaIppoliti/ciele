import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth";

/**
 * The authorization seam (requireMember): every org-scoped server action
 * starts here. Tested by stubbing the session: the check is the session's
 * Capability set against what the action requires (ADR-0028).
 */

const {
  countActiveAlertsMock,
  getSessionMock,
  listActiveAlertsMock,
  listAssistantShellSummariesMock,
  listAssistantsMock,
  reactCacheMock,
  redirectMock,
  resetReactCacheMock,
} = vi.hoisted(() => ({
  ...(() => {
    const cacheResetters: Array<() => void> = [];
    return {
      reactCacheMock: <Args extends unknown[], Result>(
        fn: (...args: Args) => Result,
      ) => {
        let hasValue = false;
        let value: Result;
        cacheResetters.push(() => {
          hasValue = false;
        });
        return (...args: Args) => {
          if (!hasValue) {
            value = fn(...args);
            hasValue = true;
          }
          return value;
        };
      },
      resetReactCacheMock: () => {
        cacheResetters.forEach((reset) => reset());
      },
    };
  })(),
  countActiveAlertsMock: vi.fn(),
  getSessionMock: vi.fn(),
  listActiveAlertsMock: vi.fn(),
  listAssistantShellSummariesMock: vi.fn(),
  listAssistantsMock: vi.fn(),
  redirectMock: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

vi.mock("@/lib/auth", () => ({ getSession: getSessionMock }));
vi.mock("@/lib/data", () => ({
  getDb: async () => ({
    countActiveAlerts: countActiveAlertsMock,
    listActiveAlerts: listActiveAlertsMock,
    listAssistantShellSummaries: listAssistantShellSummariesMock,
    listAssistants: listAssistantsMock,
  }),
}));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  cache: reactCacheMock,
}));

import { capabilitiesForLadderRole } from "@agent-hub/core";
import { requireMember } from "./authz";

function session(role: Session["role"], withOrg = true, capabilities?: string[]): Session {
  return {
    userId: "user-1",
    email: "member@example.com",
    organization: withOrg ? { id: "org-1", name: "Org" } : null,
    role,
    capabilities: capabilities ?? capabilitiesForLadderRole(role),
    demo: false,
  } as Session;
}

beforeEach(() => {
  resetReactCacheMock();
  countActiveAlertsMock.mockReset().mockResolvedValue(2);
  listActiveAlertsMock.mockReset().mockResolvedValue([]);
  listAssistantShellSummariesMock.mockReset().mockResolvedValue([]);
  getSessionMock.mockReset();
  listAssistantsMock.mockReset().mockResolvedValue([]);
});

describe("requireMember", () => {
  it("redirects to /login when signed out", async () => {
    getSessionMock.mockResolvedValue(null);
    await expect(requireMember()).rejects.toThrow("REDIRECT:/login");
  });

  it("redirects to /onboarding when the member has no organization", async () => {
    getSessionMock.mockResolvedValue(session("owner", false));
    await expect(requireMember()).rejects.toThrow("REDIRECT:/onboarding");
  });

  it("hands back the org-scoped context for any member", async () => {
    getSessionMock.mockResolvedValue(session("viewer"));
    const ctx = await requireMember();
    expect(ctx.organizationId).toBe("org-1");
    expect(ctx.session.role).toBe("viewer");
    expect(ctx.db).toBeTruthy();
  });

  it.each([
    ["viewer", false],
    ["support_agent", false],
    ["editor", true],
    ["admin", true],
    ["owner", true],
  ] as const)("flows:edit with a built-in %s → %s", async (role, allowed) => {
    getSessionMock.mockResolvedValue(session(role));
    const attempt = requireMember("flows:edit");
    if (allowed) await expect(attempt).resolves.toBeTruthy();
    else await expect(attempt).rejects.toThrow("Your role does not allow this (Create and edit Flows)");
  });

  it("checks the Role's Capabilities, not its tier", async () => {
    // An Admin-tier custom Role that may publish and nothing else.
    getSessionMock.mockResolvedValue(session("admin", true, ["assistants:view", "assistants:publish"]));
    await expect(requireMember("assistants:publish")).resolves.toBeTruthy();
    await expect(requireMember("members:manage")).rejects.toThrow("Your role does not allow this (Manage Members)");
    await expect(requireMember("flows:edit")).rejects.toThrow(/Create and edit Flows/);
  });

  it("lets any Member through for their own things", async () => {
    getSessionMock.mockResolvedValue(session("viewer", true, []));
    await expect(requireMember("member")).resolves.toBeTruthy();
    await expect(requireMember("inbox:view")).rejects.toThrow(/View conversations/);
  });

  it("keeps the Owner-only Capability for Owners", async () => {
    getSessionMock.mockResolvedValue(session("admin"));
    await expect(requireMember("personalSubscriptions:manage")).rejects.toThrow(/personal AI subscriptions/);
    getSessionMock.mockResolvedValue(session("owner"));
    await expect(requireMember("personalSubscriptions:manage")).resolves.toBeTruthy();
  });
});

describe("requirePageMember", () => {
  it("redirects a session-less render to /onboarding", async () => {
    getSessionMock.mockResolvedValue(null);
    const { requirePageMember } = await import("./authz");
    await expect(requirePageMember()).rejects.toThrow("REDIRECT:/onboarding");
  });

  it("redirects to /onboarding when the member has no organization", async () => {
    getSessionMock.mockResolvedValue(session("owner", false));
    const { requirePageMember } = await import("./authz");
    await expect(requirePageMember()).rejects.toThrow("REDIRECT:/onboarding");
  });

  it("hands back session, organizationId, role and db", async () => {
    getSessionMock.mockResolvedValue(session("editor"));
    const { requirePageMember } = await import("./authz");
    const ctx = await requirePageMember();
    expect(ctx.organizationId).toBe("org-1");
    expect(ctx.role).toBe("editor");
    expect(ctx.session.organization.id).toBe("org-1");
    expect(ctx.db).toBeTruthy();
  });

  it("keeps the shell's narrow Assistant read request-scoped", async () => {
    getSessionMock.mockResolvedValue(session("editor"));
    const { requirePageMember } = await import("./authz");
    const ctx = await requirePageMember();

    const [assistants, shellAssistants, alertCount, alerts] = await Promise.all([
      ctx.reads.assistants(),
      ctx.reads.assistantShellSummaries(),
      ctx.reads.activeAlertCount(),
      ctx.reads.activeAlerts(),
    ]);

    expect(assistants).toEqual([]);
    expect(shellAssistants).toEqual([]);
    expect(alertCount).toBe(2);
    expect(alerts).toEqual([]);
    expect(listAssistantsMock).toHaveBeenCalledOnce();
    expect(listAssistantShellSummariesMock).toHaveBeenCalledOnce();
    expect(countActiveAlertsMock).toHaveBeenCalledOnce();
    expect(listActiveAlertsMock).toHaveBeenCalledOnce();
  });

  it("shares one read coordinator between concurrent layout and page guards", async () => {
    getSessionMock.mockResolvedValue(session("editor"));
    const { requirePageMember } = await import("./authz");

    const [layoutContext, pageContext] = await Promise.all([
      requirePageMember(),
      requirePageMember(),
    ]);
    await Promise.all([
      layoutContext.reads.assistantShellSummaries(),
      layoutContext.reads.assistants(),
      layoutContext.reads.activeAlertCount(),
      pageContext.reads.assistants(),
    ]);

    expect(layoutContext.reads).toBe(pageContext.reads);
    expect(listAssistantsMock).toHaveBeenCalledOnce();
    expect(listAssistantShellSummariesMock).toHaveBeenCalledOnce();
    expect(countActiveAlertsMock).toHaveBeenCalledOnce();
  });
});
