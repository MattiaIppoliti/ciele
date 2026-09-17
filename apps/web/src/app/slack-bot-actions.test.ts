import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/authz", () => ({ requireMember: vi.fn(), requireSession: vi.fn() }));
vi.mock("@/lib/widget-db", () => ({ getWidgetDb: vi.fn() }));
vi.mock("@/lib/org-mutation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/org-mutation")>()),
  revalidateEntities: vi.fn(),
}));
vi.mock("@/lib/supabase/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/service")>()),
  isSupabaseServiceConfigured: vi.fn(() => true),
}));
vi.mock("@/lib/slack/settings", () => ({ saveSlackBotSettings: vi.fn() }));
vi.mock("@agent-hub/agent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-hub/agent")>()),
  discoverApplicationConnectionScopes: vi.fn(),
}));

import { discoverApplicationConnectionScopes } from "@agent-hub/agent";
import { requireMember } from "@/lib/authz";
import { getWidgetDb } from "@/lib/widget-db";
import { saveSlackBotSettings } from "@/lib/slack/settings";
import { configureSlackBotAction } from "./actions";

const config = { assistantId: "assistant-1", channelIds: ["CTEST"] };
const channels = [
  {
    id: "CTEST",
    label: "#ctest",
    kind: "channel" as const,
    parentId: null,
    metadata: { member: true },
  },
];

describe("configureSlackBotAction", () => {
  const requireMemberMock = vi.mocked(requireMember);
  const saveMock = vi.mocked(saveSlackBotSettings);
  const discoverMock = vi.mocked(discoverApplicationConnectionScopes);
  const connection = {
    id: "conn-1",
    organizationId: "org-1",
    provider: "slack",
    status: "connected",
  };
  const db = { getSafeApplicationConnection: vi.fn(async () => connection) };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("SLACK_APPLICATION_APP_ID", "ATEST");
    vi.stubEnv("SLACK_SIGNING_SECRET", "signing-secret");
    vi.stubEnv("APP_ENCRYPTION_KEY", "slack-action-test-key");
    requireMemberMock.mockResolvedValue({
      db,
      organizationId: "org-1",
    } as unknown as Awaited<ReturnType<typeof requireMember>>);
    vi.mocked(getWidgetDb).mockReturnValue({
      getApplicationConnection: vi.fn(async () => connection),
    } as never);
    discoverMock.mockResolvedValue({ scopes: channels });
  });

  it("publishes an audience, so it needs publish permission and the session's Organization", async () => {
    await configureSlackBotAction("conn-1", config);
    expect(requireMemberMock).toHaveBeenCalledWith("publish");
    expect(saveMock).toHaveBeenCalledWith(db, "org-1", "conn-1", config, {
      expectedAppId: "ATEST",
      channels,
    });
    requireMemberMock.mockRejectedValue(new Error("Forbidden"));
    await expect(configureSlackBotAction("conn-1", config)).rejects.toThrow(
      "Forbidden",
    );
    expect(saveMock).toHaveBeenCalledOnce();
  });

  it("refuses to enable a bot this deployment receives no events for", async () => {
    for (const missing of ["SLACK_APPLICATION_APP_ID", "SLACK_SIGNING_SECRET"]) {
      vi.stubEnv(missing, "");
      await expect(configureSlackBotAction("conn-1", config)).rejects.toThrow(
        "Configure Slack event delivery",
      );
      vi.stubEnv(missing, "restored");
    }
    expect(saveMock).not.toHaveBeenCalled();
    expect(discoverMock).not.toHaveBeenCalled();
  });

  it("always allows opt-out, without discovery or the event-delivery precondition", async () => {
    vi.stubEnv("SLACK_APPLICATION_APP_ID", "");
    await configureSlackBotAction("conn-1", null);
    expect(saveMock).toHaveBeenCalledWith(db, "org-1", "conn-1", null);
    expect(discoverMock).not.toHaveBeenCalled();
  });
});
