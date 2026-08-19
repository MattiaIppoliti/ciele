import { describe, expect, it, vi } from "vitest";
// after() is the enqueue accelerator (Suggested Fix drafting on escalation);
// a no-op keeps it out of the escalation-transaction assertions.
vi.mock("next/server", () => ({ after: vi.fn() }));
import type { Db } from "@agent-hub/db";
import { DEMO_ORG, getMockDb } from "@agent-hub/db";
import type { Assistant, ChannelFormField } from "@agent-hub/core";

import type { EmailTransport } from "@agent-hub/agent";
import type { EmailMessage } from "@agent-hub/agent";
import { escalateConversation, type EscalationRequest } from "./escalation";

/**
 * The Escalation transaction tested through its public operation with the
 * in-memory Db and a captured fake transport (prior art: the Conversation
 * Turn suite), no HTTP involved.
 */

const db = getMockDb();

const FORM: ChannelFormField[] = [
  {
    id: "email",
    type: "user_email",
    label: "Email",
    useAsReplyTo: true,
    required: true,
    showInForm: true,
  },
  { id: "subject", type: "short_text", label: "Subject", showInForm: true },
  {
    id: "description",
    type: "long_text",
    label: "Description",
    required: true,
    showInForm: true,
  },
];

async function fixture(options: { autoImprovements?: boolean } = {}) {
  const assistant = await db.createAssistant(DEMO_ORG.id, {
    title: "Escalation Test Assistant",
  });
  let desk = await db.createHelpDesk(DEMO_ORG.id, { name: "IT Desk" });
  if (options.autoImprovements) {
    desk = await db.updateHelpDesk(desk.id, { autoGenerateImprovements: true });
  }
  const channel = await db.createSupportChannel(desk.id, {
    kind: "email",
    name: "Email us",
    config: { destinationEmail: "help@example.com" },
    form: FORM,
    confirmationMessage: "We got it!",
  });
  const conversation = await db.createConversation({
    assistantId: assistant.id,
    subjectType: "visitor",
    subjectId: "visitor-1",
    title: "Wifi help",
  });
  await db.appendMessage({
    conversationId: conversation.id,
    role: "user",
    content: [{ type: "text", text: "The wifi keeps dropping" }],
  });
  const answer = await db.appendMessage({
    conversationId: conversation.id,
    role: "assistant",
    content: [{ type: "text", text: "Try forgetting the network." }],
  });
  return { assistant, desk, channel, conversation, answer };
}

function run(
  assistant: Assistant,
  request: EscalationRequest,
  options: {
    transport?: EmailTransport;
    db?: Db;
    assistantId?: string;
  } = {}
) {
  return escalateConversation({
    db: options.db ?? db,
    assistantId: options.assistantId ?? assistant.id,
    assistant,
    request,
    transport: options.transport ?? (async () => ({ delivered: true }) as const),
  });
}

const FILLED = {
  email: "visitor@example.com",
  subject: "Wifi down",
  description: "It drops every few minutes.",
};

describe("escalateConversation, validation", () => {
  it("rejects a request without a visitor", async () => {
    const { assistant, desk, conversation } = await fixture();
    expect(
      await run(assistant, { conversationId: conversation.id, helpDeskId: desk.id })
    ).toEqual({ kind: "bad_request" });
  });

  it("rejects a request with neither conversation nor channel", async () => {
    const { assistant, desk } = await fixture();
    expect(
      await run(assistant, { visitorId: "visitor-1", helpDeskId: desk.id })
    ).toEqual({ kind: "bad_request" });
  });

  it("rejects a conversation belonging to another assistant", async () => {
    const { assistant, desk, conversation } = await fixture();
    const other = await db.createAssistant(DEMO_ORG.id, { title: "Other" });
    expect(
      await run(
        assistant,
        {
          visitorId: "visitor-1",
          conversationId: conversation.id,
          helpDeskId: desk.id,
        },
        { assistantId: other.id }
      )
    ).toEqual({ kind: "not_found" });
  });

  it("rejects a conversation started by a different visitor", async () => {
    const { assistant, desk, conversation } = await fixture();
    expect(
      await run(assistant, {
        visitorId: "someone-else",
        conversationId: conversation.id,
        helpDeskId: desk.id,
      })
    ).toEqual({ kind: "not_found" });
  });

  it("rejects a desk belonging to another Organization", async () => {
    const { assistant, conversation } = await fixture();
    const foreign = {
      ...assistant,
      organizationId: "some-other-org",
    } as Assistant;
    const desk = await db.createHelpDesk(DEMO_ORG.id, { name: "Foreign Desk" });
    expect(
      await run(foreign, {
        visitorId: "visitor-1",
        conversationId: conversation.id,
        helpDeskId: desk.id,
      })
    ).toEqual({ kind: "not_found" });
  });

  it("rejects an unknown, disabled or non-email channel", async () => {
    const { assistant, desk, channel, conversation } = await fixture();
    const base = {
      visitorId: "visitor-1",
      conversationId: conversation.id,
      helpDeskId: desk.id,
      fields: FILLED,
    };
    expect(await run(assistant, { ...base, channelId: "missing" })).toEqual({
      kind: "not_found",
    });

    const phone = await db.createSupportChannel(desk.id, {
      kind: "phone",
      name: "Call us",
      config: { phoneNumber: "+39 06 000" },
    });
    expect(await run(assistant, { ...base, channelId: phone.id })).toEqual({
      kind: "not_found",
    });

    await db.updateSupportChannel(channel.id, { enabled: false });
    expect(await run(assistant, { ...base, channelId: channel.id })).toEqual({
      kind: "not_found",
    });
  });

  it("names the missing required fields", async () => {
    const { assistant, desk, channel, conversation } = await fixture();
    const outcome = await run(assistant, {
      visitorId: "visitor-1",
      conversationId: conversation.id,
      helpDeskId: desk.id,
      channelId: channel.id,
      fields: { subject: "only optional filled" },
    });
    expect(outcome).toEqual({
      kind: "missing_fields",
      missing: ["Email", "Description"],
    });
  });
});

describe("escalateConversation, email", () => {
  it("composes the escalation email from the configured form", async () => {
    const { assistant, desk, channel, conversation } = await fixture();
    const sent: EmailMessage[] = [];
    const outcome = await run(
      assistant,
      {
        visitorId: "visitor-1",
        conversationId: conversation.id,
        helpDeskId: desk.id,
        channelId: channel.id,
        fields: FILLED,
      },
      { transport: async (m) => (sent.push(m), { delivered: true } as const) }
    );
    expect(outcome).toEqual({
      kind: "ok",
      email: { delivered: true, fallbackAddress: null },
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("help@example.com");
    expect(sent[0].subject).toBe("Wifi down");
    expect(sent[0].replyTo).toBe("visitor@example.com");
    expect(sent[0].body).toContain("Description: It drops every few minutes.");
    // conversationData defaults exclude full chat history → no transcript.
    expect(sent[0].body).not.toContain("--- Conversation ---");
  });

  it("attaches the transcript when the channel includes full chat history", async () => {
    const { assistant, desk, channel, conversation } = await fixture();
    await db.updateSupportChannel(channel.id, {
      conversationData: { fullChatHistory: true },
    });
    const sent: EmailMessage[] = [];
    await run(
      assistant,
      {
        visitorId: "visitor-1",
        conversationId: conversation.id,
        helpDeskId: desk.id,
        channelId: channel.id,
        fields: FILLED,
      },
      { transport: async (m) => (sent.push(m), { delivered: true } as const) }
    );
    expect(sent[0].body).toContain("--- Conversation ---");
    expect(sent[0].body).toContain("User: The wifi keeps dropping");
    expect(sent[0].body).toContain("Assistant: Try forgetting the network.");
  });

  it("accepts a form submission without a conversation (always-available button)", async () => {
    const { assistant, desk, channel } = await fixture();
    const sent: EmailMessage[] = [];
    const outcome = await run(
      assistant,
      {
        visitorId: "visitor-1",
        helpDeskId: desk.id,
        channelId: channel.id,
        fields: FILLED,
      },
      { transport: async (m) => (sent.push(m), { delivered: true } as const) }
    );
    expect(outcome).toEqual({
      kind: "ok",
      email: { delivered: true, fallbackAddress: null },
    });
    expect(sent).toHaveLength(1);
  });

  it("submits an api_endpoint channel form to the configured endpoint (#315)", async () => {
    const { assistant, desk, conversation } = await fixture();
    const endpoint = await db.createSupportChannel(desk.id, {
      kind: "api_endpoint",
      name: "Webhook",
      config: { url: "https://api.example.com/escalate" },
      form: FORM,
    });
    const calls: Array<{ config: unknown; payload: unknown }> = [];
    const outcome = await escalateConversation({
      db,
      assistantId: assistant.id,
      assistant,
      request: {
        visitorId: "visitor-1",
        conversationId: conversation.id,
        helpDeskId: desk.id,
        channelId: endpoint.id,
        fields: FILLED,
      },
      endpointTransport: async (config, payload) => {
        calls.push({ config, payload });
        return { ok: true, status: 200, bodyText: "{}", errorCode: null };
      },
    });
    expect(outcome).toEqual({ kind: "ok", email: undefined });
    expect(calls).toHaveLength(1);
    expect(calls[0].payload).toMatchObject({
      helpDesk: "IT Desk",
      conversationId: conversation.id,
      fields: expect.arrayContaining([
        expect.objectContaining({ id: "subject", value: "Wifi down" }),
      ]),
    });
  });

  it("answers endpoint_failed (and does not flag the conversation) when the endpoint errors (#315)", async () => {
    const { assistant, desk, conversation } = await fixture();
    const endpoint = await db.createSupportChannel(desk.id, {
      kind: "api_endpoint",
      name: "Webhook",
      config: { url: "https://api.example.com/escalate" },
      form: FORM,
    });
    const outcome = await escalateConversation({
      db,
      assistantId: assistant.id,
      assistant,
      request: {
        visitorId: "visitor-1",
        conversationId: conversation.id,
        helpDeskId: desk.id,
        channelId: endpoint.id,
        fields: FILLED,
      },
      endpointTransport: async () => ({
        ok: false,
        status: null,
        bodyText: null,
        errorCode: "network",
      }),
    });
    expect(outcome).toEqual({ kind: "endpoint_failed" });
    expect(
      (await db.getConversation(conversation.id))?.metadata?.escalated
    ).not.toBe(true);
  });

  it("reports non-delivery with the destination as an honest mailto fallback", async () => {
    const { assistant, desk, channel, conversation } = await fixture();
    const outcome = await run(
      assistant,
      {
        visitorId: "visitor-1",
        conversationId: conversation.id,
        helpDeskId: desk.id,
        channelId: channel.id,
        fields: FILLED,
      },
      {
        transport: async () =>
          ({ delivered: false, reason: "not_configured" }) as const,
      }
    );
    expect(outcome).toEqual({
      kind: "ok",
      email: { delivered: false, fallbackAddress: "help@example.com" },
    });
  });
});

describe("escalateConversation, escalated flag and auto-Improvements", () => {
  it("marks the conversation escalated and records which desk took it", async () => {
    const { assistant, desk, conversation } = await fixture();
    await run(assistant, {
      visitorId: "visitor-1",
      conversationId: conversation.id,
      helpDeskId: desk.id,
    });
    const updated = await db.getConversation(conversation.id);
    expect(updated?.metadata?.escalated).toBe(true);
    // The Inbox rail and the export say more than "escalated" (#561).
    expect(updated?.metadata?.escalationHelpDesk).toBe("IT Desk");
    // No channel was submitted, so there is no option to name.
    expect(updated?.metadata?.escalationOption).toBeUndefined();
  });

  it("records the channel the visitor actually took", async () => {
    const { assistant, desk, channel, conversation } = await fixture();
    await run(assistant, {
      visitorId: "visitor-1",
      conversationId: conversation.id,
      helpDeskId: desk.id,
      channelId: channel.id,
      fields: FILLED,
    });
    const updated = await db.getConversation(conversation.id);
    expect(updated?.metadata?.escalationHelpDesk).toBe("IT Desk");
    expect(updated?.metadata?.escalationOption).toBe("Email us");
  });

  it("raises an Improvement from the last AI answer on the first escalation only", async () => {
    const { assistant, desk, conversation, answer } = await fixture({
      autoImprovements: true,
    });
    const before = (await db.listImprovements(DEMO_ORG.id)).length;
    const request = {
      visitorId: "visitor-1",
      conversationId: conversation.id,
      helpDeskId: desk.id,
    };
    await run(assistant, request);
    const afterFirst = await db.listImprovements(DEMO_ORG.id);
    expect(afterFirst.length).toBe(before + 1);
    const raised = afterFirst.find((i) =>
      i.title.startsWith("Escalated: The wifi keeps dropping")
    );
    expect(raised).toBeDefined();
    const links = await db.listImprovementMessages(raised!.id);
    expect(links.some((l) => l.message.id === answer.id)).toBe(true);

    // Second escalation of the same conversation: no new item.
    await run(assistant, request);
    expect((await db.listImprovements(DEMO_ORG.id)).length).toBe(before + 1);
  });

  it("does not raise an Improvement when the desk has auto-generate off", async () => {
    const { assistant, desk, conversation } = await fixture();
    const before = (await db.listImprovements(DEMO_ORG.id)).length;
    await run(assistant, {
      visitorId: "visitor-1",
      conversationId: conversation.id,
      helpDeskId: desk.id,
    });
    expect((await db.listImprovements(DEMO_ORG.id)).length).toBe(before);
  });

  it("still succeeds when the tracker write fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { assistant, desk, conversation } = await fixture({
      autoImprovements: true,
    });
    const failing = new Proxy(db, {
      get(target, prop) {
        if (prop === "createImprovement") {
          return async () => {
            throw new Error("tracker down");
          };
        }
        return Reflect.get(target, prop);
      },
    }) as Db;
    const outcome = await run(
      assistant,
      {
        visitorId: "visitor-1",
        conversationId: conversation.id,
        helpDeskId: desk.id,
      },
      { db: failing }
    );
    expect(outcome).toEqual({ kind: "ok" });
    expect((await db.getConversation(conversation.id))?.metadata?.escalated).toBe(
      true
    );
    spy.mockRestore();
  });
});
