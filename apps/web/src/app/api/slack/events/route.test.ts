import { createHmac } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  configured: vi.fn(() => true),
  enqueue: vi.fn(async () => true),
  run: vi.fn(),
  db: {},
}));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/widget-db", () => ({ getWidgetDb: () => mocks.db }));
vi.mock("@/lib/runtime-db", () => ({ getRuntimeDb: () => mocks.db }));
vi.mock("@/lib/supabase/service", () => ({
  isSupabaseServiceConfigured: mocks.configured,
}));
vi.mock("@agent-hub/agent", () => ({
  enqueueSlackMention: mocks.enqueue,
  runDueSlackMentionJobs: mocks.run,
}));
import { POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.configured.mockReturnValue(true);
  mocks.enqueue.mockResolvedValue(true);
  vi.stubEnv("SLACK_SIGNING_SECRET", "test-secret");
  vi.stubEnv("SLACK_APPLICATION_APP_ID", "ATEST");
});
afterEach(() => vi.unstubAllEnvs());

function request(payload: unknown, signed = true) {
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  return new Request("https://ciele.test/api/slack/events", {
    method: "POST",
    body,
    headers: signed
      ? {
          "x-slack-request-timestamp": timestamp,
          "x-slack-signature": `v0=${createHmac("sha256", "test-secret").update(`v0:${timestamp}:${body}`).digest("hex")}`,
        }
      : {},
  });
}
const event = {
  type: "event_callback",
  api_app_id: "ATEST",
  team_id: "TTEST",
  event_id: "EvTEST",
  event: {
    type: "app_mention",
    channel: "CTEST",
    user: "UTEST",
    text: "hello",
    ts: "1770000000.000001",
  },
};

it("validates Slack's challenge only after signature authentication", async () => {
  const challenge = { type: "url_verification", challenge: "verify-me" };
  expect((await POST(request(challenge, false))).status).toBe(401);
  expect(await (await POST(request(challenge))).json()).toEqual({
    challenge: "verify-me",
  });
  expect(mocks.enqueue).not.toHaveBeenCalled();
});
it("persists before acknowledgement and defers all model and Slack calls", async () => {
  expect((await POST(request(event))).status).toBe(200);
  expect(mocks.enqueue).toHaveBeenCalledOnce();
  expect(mocks.after).toHaveBeenCalledOnce();
  expect(mocks.run).not.toHaveBeenCalled();
  await mocks.after.mock.calls[0][0]();
  expect(mocks.run).toHaveBeenCalledWith({ db: mocks.db }, { budgetMs: 300_000 });
});
it("returns retryable failure when storage is unavailable, and ignores other apps", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.enqueue.mockRejectedValue(new Error("migration not ready"));
  expect((await POST(request(event))).status).toBe(503);
  expect(logged).toHaveBeenCalledWith(
    expect.stringContaining("Apply the Slack migration"),
    expect.any(Error),
  );
  expect(mocks.after).not.toHaveBeenCalled();
  expect((await POST(request({ ...event, api_app_id: "AOTHER" }))).status).toBe(
    200,
  );
  expect(mocks.enqueue).toHaveBeenCalledOnce();
});
it("does not accept events without the service-role database", async () => {
  mocks.configured.mockReturnValue(false);
  expect((await POST(request(event))).status).toBe(503);
  expect(mocks.enqueue).not.toHaveBeenCalled();
});
it("bounds the raw body even without a content-length header", async () => {
  expect(
    (
      await POST(
        new Request("https://ciele.test/api/slack/events", {
          method: "POST",
          body: "a".repeat(256001),
        }),
      )
    ).status,
  ).toBe(413);
  expect(mocks.enqueue).not.toHaveBeenCalled();
});
