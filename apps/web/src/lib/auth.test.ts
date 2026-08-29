import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * getSession must answer from a locally verified JWT (auth.getClaims, a
 * JWKS-cached WebCrypto check) and never from the auth.getUser() network
 * round trip: it runs on every admin page render, so a network call here is
 * a per-navigation latency tax (see middleware.ts, which makes the same
 * trade). Tested by stubbing supabase-config detection and the supabase
 * client, mirroring how authz.test.ts stubs the session seam.
 */

const { isSupabaseConfiguredMock, getClaimsMock, getUserMock } = vi.hoisted(
  () => ({
    isSupabaseConfiguredMock: vi.fn(),
    getClaimsMock: vi.fn(),
    getUserMock: vi.fn(),
  })
);

vi.mock("@agent-hub/db", () => ({
  isSupabaseConfigured: isSupabaseConfiguredMock,
  DEMO_MEMBER: { userId: "demo", email: "demo@example.com", role: "owner" },
  DEMO_ORG: { id: "demo-org", name: "Demo" },
}));
vi.mock("@/lib/data", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getClaims: getClaimsMock, getUser: getUserMock },
  }),
}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

import { getDb } from "@/lib/data";
import { getSession } from "./auth";

beforeEach(() => {
  isSupabaseConfiguredMock.mockReset();
  getClaimsMock.mockReset();
  getUserMock.mockReset();
  vi.mocked(getDb).mockReset();
});

describe("getSession", () => {
  it("derives identity from the verified claims, not auth.getUser", async () => {
    isSupabaseConfiguredMock.mockReturnValue(true);
    getClaimsMock.mockResolvedValue({
      data: { claims: { sub: "u1", email: "u1@example.com" } },
    });
    const { cookies } = await import("next/headers");
    vi.mocked(cookies).mockResolvedValue({
      get: () => undefined,
    } as never);
    vi.mocked(getDb).mockResolvedValue({
      getCurrentOrg: vi.fn().mockResolvedValue(null),
      listOrganizations: vi.fn().mockResolvedValue([]),
      getProfile: vi.fn().mockResolvedValue(null),
    } as never);

    const session = await getSession();
    expect(session).toMatchObject({
      userId: "u1",
      email: "u1@example.com",
      demo: false,
    });
    expect(getUserMock).not.toHaveBeenCalled();
  });

  it("is null when the JWT does not verify", async () => {
    isSupabaseConfiguredMock.mockReturnValue(true);
    getClaimsMock.mockResolvedValue({ data: null });
    await expect(getSession()).resolves.toBeNull();
    expect(getDb).not.toHaveBeenCalled();
  });
});
