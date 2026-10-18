import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  targets: vi.fn(),
  facts: vi.fn(),
  write: vi.fn(),
  probe: vi.fn(),
  configured: vi.fn(() => false),
  rls: vi.fn(),
  createDb: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getSession: mocks.session }));
vi.mock("@agent-hub/db", () => ({
  isSupabaseConfigured: mocks.configured,
  createDb: mocks.createDb,
}));
vi.mock("@/lib/data", () => ({
  getDb: async () => ({
    listPublishedAvailabilityTargets: mocks.targets,
    getAssistantAvailability: mocks.facts,
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseSessionRlsContext: mocks.rls,
  createSupabaseRlsClient: vi.fn(),
}));
vi.mock("@/lib/widget-db", () => ({
  getWidgetDb: () => ({
    listPublishedAvailabilityTargets: mocks.targets,
    recordAssistantAvailability: mocks.write,
  }),
}));
vi.mock("@/lib/assistant-availability-probe", () => ({
  probeAssistantAvailability: mocks.probe,
}));
vi.mock("@/lib/request-diagnostics", () => ({
  withRequestDiagnostics: (
    _route: string,
    _surface: string,
    handler: unknown,
  ) => handler,
}));
vi.mock("@/lib/internal-origin", () => ({
  internalApiOrigin: () => "https://configured.example",
}));
import { GET as read } from "@/app/api/insights/availability/route";
import { GET as cron } from "@/app/api/cron/check-assistant-availability/route";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.configured.mockReturnValue(false);
  mocks.session.mockResolvedValue({ organization: { id: "own-org" } });
  mocks.targets.mockResolvedValue([]);
  mocks.facts.mockResolvedValue([]);
  vi.stubEnv("CRON_SECRET", "test-only-cron-secret");
});
afterEach(() => vi.unstubAllEnvs());
describe("availability routes", () => {
  it("requires an authenticated organization and ignores caller-supplied organization ids", async () => {
    mocks.session.mockResolvedValueOnce(null);
    expect(
      (
        await read(
          new NextRequest("http://localhost/api/insights/availability"),
        )
      ).status,
    ).toBe(401);
    const response = await read(
      new NextRequest(
        "http://localhost/api/insights/availability?organizationId=foreign&from=2026-10-01&to=2026-10-08",
      ),
    );
    expect(response.status).toBe(200);
    expect(mocks.targets).toHaveBeenCalledWith("own-org");
    expect(mocks.facts).toHaveBeenCalledWith(
      "own-org",
      "2026-10-01T00:00:00.000Z",
      "2026-10-09T00:00:00.000Z",
    );
  });
  it("tolerates a migration rollout without inventing samples", async () => {
    mocks.facts.mockRejectedValue({ code: "PGRST202" });
    expect(
      (
        await read(
          new NextRequest("http://localhost/api/insights/availability"),
        )
      ).status,
    ).toBe(503);
  });
  it("protects monitoring with the cron bearer secret", async () => {
    expect(
      (
        await cron(
          new Request("http://localhost/api/cron/check-assistant-availability"),
        )
      ).status,
    ).toBe(401);
    expect(mocks.targets).not.toHaveBeenCalled();
    vi.stubEnv("CRON_SECRET", "");
    expect(
      (
        await cron(
          new Request("http://localhost/api/cron/check-assistant-availability"),
        )
      ).status,
    ).toBe(503);
  });
  it("uses configured origin rather than hostile request host and persists samples", async () => {
    const target = { id: "a", organizationId: "own-org", title: "Assistant" };
    mocks.targets.mockResolvedValue([target]);
    mocks.probe.mockResolvedValue({ assistantId: "a", status: "up" });
    const response = await cron(
      new Request(
        "https://hostile.example/api/cron/check-assistant-availability",
        { headers: { authorization: "Bearer test-only-cron-secret" } },
      ),
    );
    expect(mocks.probe).toHaveBeenCalledWith(
      target,
      "https://configured.example",
    );
    expect(mocks.write).toHaveBeenCalledWith([
      { assistantId: "a", status: "up" },
    ]);
    expect(await response.json()).toEqual({ checked: 1, failed: 0 });
  });
});
