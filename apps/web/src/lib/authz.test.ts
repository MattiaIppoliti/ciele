import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth";

/**
 * The authorization seam (requireMember): every org-scoped server action
 * starts here. Tested by stubbing the session — the RBAC ladder itself is
 * pure (lib/rbac.ts) and exercised through the guard's capability map.
 */

const {
  countActiveAlertsMock,
  getSessionMock,
  listActiveAlertsMock,
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
    listAssistants: listAssistantsMock,
  }),
}));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  cache: reactCacheMock,
}));

import { requireMember } from "./authz";

function session(role: Session["role"], withOrg = true): Session {
  return {
    userId: "user-1",
    email: "member@example.com",
    organization: withOrg ? { id: "org-1", name: "Org" } : null,
    role,
    demo: false,
  } as Session;
}

beforeEach(() => {
  resetReactCacheMock();
  countActiveAlertsMock.mockReset().mockResolvedValue(2);
  listActiveAlertsMock.mockReset().mockResolvedValue([]);
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
    ["editor", true],
    ["admin", true],
    ["owner", true],
  ] as const)("edit capability: %s → %s", async (role, allowed) => {
    getSessionMock.mockResolvedValue(session(role));
    const attempt = requireMember("edit");
    if (allowed) await expect(attempt).resolves.toBeTruthy();
    else await expect(attempt).rejects.toThrow("Not allowed");
  });

  it.each([
    ["editor", false],
    ["admin", true],
  ] as const)("publish capability: %s → %s", async (role, allowed) => {
    getSessionMock.mockResolvedValue(session(role));
    const attempt = requireMember("publish");
    if (allowed) await expect(attempt).resolves.toBeTruthy();
    else await expect(attempt).rejects.toThrow("Only admins/owners can publish");
  });

  it("reserves changeRoles for owners", async () => {
    getSessionMock.mockResolvedValue(session("admin"));
    await expect(requireMember("changeRoles")).rejects.toThrow(
      "Only owners can change roles"
    );
    getSessionMock.mockResolvedValue(session("owner"));
    await expect(requireMember("changeRoles")).resolves.toBeTruthy();
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

  it("shares request-scoped Assistant reads with the admin shell", async () => {
    getSessionMock.mockResolvedValue(session("editor"));
    const { requirePageMember } = await import("./authz");
    const ctx = await requirePageMember();

    const [assistants, shell] = await Promise.all([
      ctx.reads.assistants(),
      ctx.reads.shell(),
    ]);

    expect(assistants).toBe(shell.assistants);
    expect(shell.activeAlertCount).toBe(2);
    expect(listAssistantsMock).toHaveBeenCalledOnce();
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
      layoutContext.reads.shell(),
      pageContext.reads.assistants(),
    ]);

    expect(layoutContext.reads).toBe(pageContext.reads);
    expect(listAssistantsMock).toHaveBeenCalledOnce();
    expect(countActiveAlertsMock).toHaveBeenCalledOnce();
  });
});
