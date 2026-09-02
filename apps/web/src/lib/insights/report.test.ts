import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  configuredMock,
  overviewMock,
  createDbMock,
  rlsContextMock,
  rlsClientMock,
  cache,
  cacheKeys,
} = vi.hoisted(() => ({
  configuredMock: vi.fn(),
  overviewMock: vi.fn(),
  createDbMock: vi.fn(),
  rlsContextMock: vi.fn(),
  rlsClientMock: vi.fn(),
  cache: new Map<string, unknown>(),
  cacheKeys: [] as string[],
}));

vi.mock("@agent-hub/db", () => ({
  createDb: createDbMock,
  isSupabaseConfigured: configuredMock,
}));
vi.mock("@/lib/data", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseRlsClient: rlsClientMock,
  getSupabaseSessionRlsContext: rlsContextMock,
}));
vi.mock("next/cache", () => ({
  unstable_cache:
    (read: (...args: unknown[]) => Promise<unknown>, keys: string[]) =>
    async (...args: unknown[]) => {
      const key = JSON.stringify([keys, args]);
      cacheKeys.push(key);
      if (!cache.has(key)) cache.set(key, await read(...args));
      return cache.get(key);
    },
}));

import { defaultInsightsFilter, getInsightsOverviewCached } from "./report";

beforeEach(() => {
  cache.clear();
  cacheKeys.length = 0;
  configuredMock.mockReset();
  overviewMock.mockReset();
  createDbMock.mockReset();
  rlsContextMock.mockReset();
  rlsClientMock.mockReset();
  rlsContextMock.mockResolvedValue({
    accessToken: "member-access-token",
    memberId: "member-a",
  });
  rlsClientMock.mockReturnValue({ kind: "rls-client" });
  createDbMock.mockReturnValue({ getInsightsOverview: overviewMock });
});

describe("getInsightsOverviewCached", () => {
  it("shares one cached overview across the Organization's Members", async () => {
    configuredMock.mockReturnValue(true);
    rlsContextMock
      .mockResolvedValueOnce({
        accessToken: "member-a-access-token",
        memberId: "member-a",
      })
      .mockResolvedValueOnce({
        accessToken: "member-b-access-token",
        memberId: "member-b",
      });
    overviewMock.mockResolvedValueOnce({ answerCount: 7 });
    const filters = defaultInsightsFilter(new Date("2026-08-30T12:00:00Z"));

    const first = await getInsightsOverviewCached("org-1", filters);
    const second = await getInsightsOverviewCached("org-1", filters);

    // The RLS policies are Organization-wide, so both Members read the same
    // numbers: one cold scan, run as the Member who missed, then a hit.
    expect(first).toEqual({ answerCount: 7 });
    expect(second).toEqual({ answerCount: 7 });
    expect(overviewMock).toHaveBeenCalledTimes(1);
    expect(rlsClientMock).toHaveBeenCalledExactlyOnceWith("member-a-access-token");
    expect(cacheKeys.join("\n")).not.toContain("access-token");
    expect(cacheKeys.join("\n")).not.toContain("member-a");
    expect(cacheKeys.join("\n")).toContain("org-1");
  });

  it("keeps Organizations and filters apart in the key", async () => {
    configuredMock.mockReturnValue(true);
    overviewMock
      .mockResolvedValueOnce({ answerCount: 1 })
      .mockResolvedValueOnce({ answerCount: 2 })
      .mockResolvedValueOnce({ answerCount: 3 });
    const filters = defaultInsightsFilter(new Date("2026-08-30T12:00:00Z"));

    expect(await getInsightsOverviewCached("org-1", filters)).toEqual({
      answerCount: 1,
    });
    expect(await getInsightsOverviewCached("org-2", filters)).toEqual({
      answerCount: 2,
    });
    expect(
      await getInsightsOverviewCached("org-1", { ...filters, aggregate: "weekly" }),
    ).toEqual({ answerCount: 3 });
    expect(overviewMock).toHaveBeenCalledTimes(3);
  });

  it("refuses to read without the authorized member access token", async () => {
    configuredMock.mockReturnValue(true);
    rlsContextMock.mockResolvedValue(null);

    await expect(
      getInsightsOverviewCached(
        "org-1",
        defaultInsightsFilter(new Date("2026-08-30T12:00:00Z")),
      ),
    ).rejects.toThrow("Authenticated session required");
    expect(createDbMock).not.toHaveBeenCalled();
  });
});
