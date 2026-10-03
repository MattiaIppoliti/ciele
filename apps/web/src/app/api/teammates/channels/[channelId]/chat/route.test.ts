import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ stream: vi.fn(), auto: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getSession: async () => ({ organization: { id: "org" }, userId: "member", role: "admin", email: "member@example.test", profile: {} }), profileName: () => "Member" }));
vi.mock("@/lib/data", () => ({ getDb: async () => ({ listProviderConnections: async () => [] }) }));
vi.mock("@/lib/operations", () => ({ runOperation: async () => ({ channel: { id: "group" }, roster: [], teammates: [{ id: "t1", modelProvider: "anthropic", modelId: "claude-sonnet-5" }, { id: "t2", modelProvider: "openai", modelId: "gpt-5.1" }], message: { id: "msg" }, targets: ["t1"] }) }));
vi.mock("@/lib/platform", () => ({ listPlatformEvalModels: async () => [] }));
vi.mock("@/lib/teammates/actions", () => ({ resolveTeammateActions: vi.fn() }));
vi.mock("@/lib/teammates/auto-model", () => ({ AUTO_MODEL: "auto", resolveAutoModel: mocks.auto, modelKey: (ref: { provider: string; modelId: string }) => `${ref.provider}:${ref.modelId}` }));
vi.mock("@agent-hub/agent", () => ({ CHANNEL_NDJSON_HEADERS: {}, streamChannelChain: mocks.stream, chatModelCandidates: () => [] }));
vi.mock("@/lib/attachments", () => ({ openAttachments: (tokens: unknown) => tokens === "sealed" ? [{ name: "notes.txt", text: "Attached context" }] : [] }));
import { POST } from "./route";
async function post(model: string, attachments?: unknown) {
  return POST(new NextRequest("http://localhost/api/teammates/channels/group/chat", { method: "POST", body: JSON.stringify({ message: "@Colleague explain", model, attachments }) }), { params: Promise.resolve({ channelId: "group" }) });
}
beforeEach(() => { vi.clearAllMocks(); mocks.auto.mockResolvedValue(null); mocks.stream.mockResolvedValue(new ReadableStream({ start(controller) { controller.close(); } })); });
it("applies the selected model to every speaker and forwards opened attachments", async () => {
  await post("google:gemini-3.5-flash", "sealed");
  const input = mocks.stream.mock.calls[0][0];
  expect(input.teammates.map((t: { modelProvider: string }) => t.modelProvider)).toEqual(["google", "google"]);
  expect(input.attachments).toEqual([{ name: "notes.txt", text: "Attached context" }]);
});
it("resolves Auto on the server and preserves configured models when no evaluation exists", async () => {
  await post("auto");
  expect(mocks.auto).toHaveBeenCalledOnce();
  expect(mocks.stream.mock.calls[0][0].teammates.map((t: { modelProvider: string }) => t.modelProvider)).toEqual(["anthropic", "openai"]);
});
it("rejects model selectors outside the catalog", async () => {
  await post("google:invented-model");
  expect(mocks.stream.mock.calls[0][0].teammates[0].modelProvider).toBe("anthropic");
});
