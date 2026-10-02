import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  session: vi.fn(), conversation: vi.fn(), message: vi.fn(), assistant: vi.fn(),
  channelMessage: vi.fn(), tableGet: vi.fn(), roster: vi.fn(), list: vi.fn(), set: vi.fn(),
  widget: vi.fn(), subject: vi.fn(), owns: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getSession: mocks.session }));
vi.mock("@/lib/widget-db", () => ({
  getWidgetDb: () => ({ getConversationForMessage: mocks.conversation, getMessage: mocks.message, getAssistant: mocks.assistant,
    getChannelMessage: mocks.channelMessage, table: () => ({ get: mocks.tableGet, list: mocks.roster }),
    listMessageReactions: mocks.list, setMessageReaction: mocks.set }),
  resolveWidgetContext: mocks.widget, widgetSubject: mocks.subject, subjectOwnsConversation: mocks.owns,
}));
import { GET, POST } from "./route";
const req = (query = "messageId=m1", body?: unknown) => new NextRequest(`http://localhost/api/chat/reactions?${query}`, body === undefined ? {} : { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ userId: "u1", email: "u1@example.org", organization: { id: "o1" }, profile: { firstName: "Ada", lastName: "Lovelace" } });
  mocks.conversation.mockResolvedValue({ assistantId: "a1", teammateId: null });
  mocks.message.mockResolvedValue({ role: "assistant" });
  mocks.assistant.mockResolvedValue({ organizationId: "o1" });
  mocks.list.mockResolvedValue([]);
});

describe("social reactions", () => {
  it("derives identity server-side for replacement emoji", async () => {
    for (const emoji of ["👍", "❤️"]) {
      expect((await POST(req(undefined, { emoji, selected: true, actorId: "forged", actorName: "Forged" }))).status).toBe(200);
      expect(mocks.set).toHaveBeenLastCalledWith({ organizationId: "o1", messageId: "m1", channelMessageId: null, actorId: "member:u1", actorName: "Ada Lovelace", emoji }, true);
    }
  });
  it("removes only the current actor's chosen emoji", async () => {
    await POST(req(undefined, { emoji: "❤️", selected: false }));
    expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({ actorId: "member:u1", emoji: "❤️" }), false);
  });
  it("refuses foreign organizations and user messages", async () => {
    mocks.assistant.mockResolvedValue({ organizationId: "other" });
    expect((await GET(req())).status).toBe(404);
    mocks.assistant.mockResolvedValue({ organizationId: "o1" });
    mocks.message.mockResolvedValue({ role: "user" });
    expect((await POST(req(undefined, { emoji: "👍", selected: true }))).status).toBe(404);
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it("refuses another Member's private Teammate conversation", async () => {
    mocks.conversation.mockResolvedValue({ teammateId: "t1", subjectId: "u2" });
    mocks.tableGet.mockResolvedValue({ organizationId: "o1" });
    expect((await GET(req())).status).toBe(404);
  });
  it("requires group membership and matches the message to that group", async () => {
    mocks.tableGet.mockResolvedValue({ organizationId: "o1" });
    mocks.channelMessage.mockResolvedValue({ organizationId: "o1", channelId: "c1", authorType: "teammate" });
    mocks.roster.mockResolvedValue([{ userId: "u2" }]);
    expect((await GET(req("messageId=m1&channelId=c1"))).status).toBe(404);
    mocks.roster.mockResolvedValue([{ userId: "u1" }]);
    expect((await POST(req("messageId=m1&channelId=c1", { emoji: "😂", selected: true }))).status).toBe(200);
    expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({ channelMessageId: "m1" }), true);
    mocks.channelMessage.mockResolvedValue({ channelId: "c2", authorType: "teammate" });
    expect((await GET(req("messageId=m1&channelId=c1"))).status).toBe(404);
  });
  it("allows reactions to human group messages but not system notices", async () => {
    mocks.tableGet.mockResolvedValue({organizationId:"o1"});
    mocks.roster.mockResolvedValue([{userId:"u1"}]);
    mocks.channelMessage.mockResolvedValue({organizationId:"o1",channelId:"c1",authorType:"member"});
    expect((await POST(req("messageId=m1&channelId=c1",{emoji:"👍",selected:true}))).status).toBe(200);
    expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({channelMessageId:"m1",actorId:"member:u1"}),true);
    mocks.channelMessage.mockResolvedValue({organizationId:"o1",channelId:"c1",authorType:"system"});
    expect((await GET(req("messageId=m1&channelId=c1"))).status).toBe(404);
  });
  it("requires widget subject ownership and uses the verified subject", async () => {
    mocks.widget.mockResolvedValue({ publication: { config: { assistant: { organizationId: "o1" } } }, cors: {} });
    mocks.subject.mockReturnValue({ type: "sso", id: "verified", gate: { claim: { name: "name", value: "Grace Hopper" } } });
    mocks.owns.mockReturnValue(false);
    expect((await GET(req("messageId=m1&assistantId=a1&visitorId=forged"))).status).toBe(404);
    mocks.owns.mockReturnValue(true);
    await POST(req("messageId=m1&assistantId=a1&visitorId=forged", { emoji: "🙌", selected: true }));
    expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({ actorId: "sso:verified", actorName: "Grace Hopper" }), true);
  });
  it("rejects unknown emoji and malformed bodies", async () => {
    for (const body of [null, { emoji: "script", selected: true }, { emoji: "👍", selected: "yes" }]) {
      expect((await POST(req(undefined, body))).status).toBe(400);
    }
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it("tolerates the additive deployment before the table exists", async () => {
    mocks.list.mockRejectedValue({ code: "PGRST205" });
    expect((await GET(req())).status).toBe(503);
  });
});
