import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  member: vi.fn(),
  save: vi.fn(),
  revalidate: vi.fn(),
  configured: vi.fn(() => true),
  db: {},
}));
vi.mock("@/lib/authz", () => ({ requireMember: mocks.member }));
vi.mock("@/lib/slack/settings", () => ({ saveSlackBotSettings: mocks.save }));
vi.mock("@/lib/org-mutation", () => ({ revalidateEntities: mocks.revalidate }));
vi.mock("@/lib/supabase/service", () => ({
  isSupabaseServiceConfigured: mocks.configured,
}));
import { configureSlackBotAction } from "./slack-actions";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.member.mockResolvedValue({ db: mocks.db, organizationId: "org-1" });
  vi.stubEnv("SLACK_APPLICATION_APP_ID", "ATEST");
  vi.stubEnv("SLACK_SIGNING_SECRET", "test-secret");
});
afterEach(() => vi.unstubAllEnvs());
const config = { assistantId: "assistant-1", channelIds: ["CTEST"] };

it("requires publish permission and derives the Organization from the session", async () => {
  await configureSlackBotAction("conn-1", config);
  expect(mocks.member).toHaveBeenCalledWith("publish");
  expect(mocks.save).toHaveBeenCalledWith(mocks.db, "org-1", "conn-1", config);
  mocks.member.mockRejectedValue(new Error("Forbidden"));
  await expect(configureSlackBotAction("conn-1", config)).rejects.toThrow(
    "Forbidden",
  );
  expect(mocks.save).toHaveBeenCalledOnce();
});

it("does not advertise an enabled bot on an unconfigured server, but always allows opt-out", async () => {
  vi.stubEnv("SLACK_SIGNING_SECRET", "");
  await expect(configureSlackBotAction("conn-1", config)).rejects.toThrow(
    "Configure Slack event delivery",
  );
  expect(mocks.save).not.toHaveBeenCalled();
  await configureSlackBotAction("conn-1", null);
  expect(mocks.save).toHaveBeenCalledWith(mocks.db, "org-1", "conn-1", null);
});
