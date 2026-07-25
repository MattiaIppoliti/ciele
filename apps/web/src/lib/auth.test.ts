import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The presence-only auth seam (hasActiveSession): the marketing home and any
 * other "signed-in?" surface goes through it instead of the full getSession,
 * so it must answer purely from auth.getUser() (or demo mode) with no Db
 * reads. Tested by stubbing supabase-config detection and the supabase
 * client, mirroring how authz.test.ts stubs the session seam.
 */

const { isSupabaseConfiguredMock, getUserMock } = vi.hoisted(() => ({
  isSupabaseConfiguredMock: vi.fn(),
  getUserMock: vi.fn(),
}));

vi.mock("@agent-hub/db", () => ({
  isSupabaseConfigured: isSupabaseConfiguredMock,
  DEMO_MEMBER: { userId: "demo", email: "demo@example.com", role: "owner" },
  DEMO_ORG: { id: "demo-org", name: "Demo" },
}));
vi.mock("@/lib/data", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: getUserMock },
  }),
}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

import { getDb } from "@/lib/data";
import { hasActiveSession } from "./auth";

beforeEach(() => {
  isSupabaseConfiguredMock.mockReset();
  getUserMock.mockReset();
  vi.mocked(getDb).mockReset();
});

describe("hasActiveSession", () => {
  it("is true in demo mode without touching supabase or the Db", async () => {
    isSupabaseConfiguredMock.mockReturnValue(false);
    await expect(hasActiveSession()).resolves.toBe(true);
    expect(getUserMock).not.toHaveBeenCalled();
    expect(getDb).not.toHaveBeenCalled();
  });

  it("is true when a user is signed in", async () => {
    isSupabaseConfiguredMock.mockReturnValue(true);
    getUserMock.mockResolvedValue({ data: { user: { id: "u1" } } });
    await expect(hasActiveSession()).resolves.toBe(true);
    // Presence only — never reads the org/profile/org-list through the Db.
    expect(getDb).not.toHaveBeenCalled();
  });

  it("is false when signed out", async () => {
    isSupabaseConfiguredMock.mockReturnValue(true);
    getUserMock.mockResolvedValue({ data: { user: null } });
    await expect(hasActiveSession()).resolves.toBe(false);
    expect(getDb).not.toHaveBeenCalled();
  });
});
