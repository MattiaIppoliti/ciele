import { describe, expect, it, vi } from "vitest";
// after() is the enqueue accelerator (Suggested Fix drafting on escalation);
// a no-op keeps it out of the escalation-transaction assertions.
vi.mock("next/server", () => ({ after: vi.fn() }));
import type { Db } from "@agent-hub/db";
import { DEMO_MEMBER, DEMO_ORG, getMockDb } from "@agent-hub/db";
import type { Assistant, ChannelFormField } from "@agent-hub/core";

import type { EmailTransport } from "@agent-hub/agent";
import type { EmailMessage } from "@agent-hub/agent";
import type { TicketDraft, TicketingTarget } from "@agent-hub/core";
import type { TicketFilingOutcome } from "@agent-hub/agent";
import { escalateConversation, type EscalationRequest } from "./escalation";
import { ticketingAlertKey } from "./escalation-ticket";

it("records the chosen contact link for webhook events without submitting its form", async () => {
  const { assistant, desk, conversation, channel } = await fixture();
  const phone = await db.createSupportChannel(desk.id, { kind: "phone", name: "Call support", config: { phoneNumber: "+3906123456" } });
  expect((await run(assistant, { visitorId: "visitor-1", conversationId: conversation.id, helpDeskId: desk.id, contactChannelId: phone.id })).kind).toBe("ok");
  expect((await db.getConversation(conversation.id))?.metadata).toMatchObject({ escalationChannelId: phone.id, escalationOption: "Call support" });
  expect(await run(assistant, { visitorId: "visitor-1", conversationId: conversation.id, helpDeskId: desk.id, contactChannelId: channel.id })).toEqual({ kind: "not_found" });
});

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
    const calls: Array<{ config: unknown; payload: unknown; idempotencyKey?: string }> = [];
    const outcome = await escalateConversation({
      db,
      assistantId: assistant.id,
      assistant,
      request: {
        requestId: "escalation-request-1",
        visitorId: "visitor-1",
        conversationId: conversation.id,
        helpDeskId: desk.id,
        channelId: endpoint.id,
        fields: FILLED,
      },
      endpointTransport: async (config, payload, idempotencyKey) => {
        calls.push({ config, payload, idempotencyKey });
        return { ok: true, status: 200, bodyText: "{}", errorCode: null };
      },
    });
    expect(outcome).toEqual({ kind: "ok", email: undefined });
    expect(calls).toHaveLength(1);
    expect(calls[0].idempotencyKey).toMatch(
      new RegExp(`^escalation/${assistant.id}/[a-f0-9]{64}$`)
    );
    expect(calls[0].payload).toMatchObject({
      helpDesk: "IT Desk",
      conversationId: conversation.id,
      fields: expect.arrayContaining([
        expect.objectContaining({ id: "subject", value: "Wifi down" }),
      ]),
    });
  });

  it("keeps legacy retry keys stable without deduplicating different visitors", async () => {
    const { assistant, desk } = await fixture();
    const endpoint = await db.createSupportChannel(desk.id, {
      kind: "api_endpoint",
      name: "Webhook",
      config: { url: "https://api.example.com/escalate" },
      form: FORM,
    });
    const keys: string[] = [];
    const endpointTransport = async (
      _config: unknown,
      _payload: unknown,
      idempotencyKey?: string
    ) => {
      keys.push(idempotencyKey ?? "");
      return { ok: true, status: 200, bodyText: "{}", errorCode: null } as const;
    };
    const submit = (visitorId: string) =>
      escalateConversation({
        db,
        assistantId: assistant.id,
        assistant,
        request: {
          visitorId,
          helpDeskId: desk.id,
          channelId: endpoint.id,
          fields: FILLED,
        },
        endpointTransport,
      });

    await submit("visitor-1");
    await submit("visitor-1");
    await submit("visitor-2");

    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
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

  it("records the pre-flight's recommended desk and whether the visitor followed it (#955)", async () => {
    const { assistant, desk, conversation } = await fixture();
    await db.updateConversationMetadata(conversation.id, { preflight: { recommendedHelpDeskId: desk.id } });
    await run(assistant, { visitorId: "visitor-1", conversationId: conversation.id, helpDeskId: desk.id });
    const followed = await db.getConversation(conversation.id);
    expect(followed?.metadata?.escalationRecommendedHelpDesk).toBe("IT Desk");
    expect(followed?.metadata?.escalationFollowedRecommendation).toBe(true);

    const other = await db.createHelpDesk(assistant.organizationId, { name: "Billing", description: "" });
    await db.updateConversationMetadata(conversation.id, { preflight: { recommendedHelpDeskId: other.id } });
    await run(assistant, { visitorId: "visitor-1", conversationId: conversation.id, helpDeskId: desk.id });
    const ignored = await db.getConversation(conversation.id);
    expect(ignored?.metadata?.escalationRecommendedHelpDesk).toBe("Billing");
    expect(ignored?.metadata?.escalationFollowedRecommendation).toBe(false);
  });

  it("records no recommendation fields when the pre-flight recommended nothing", async () => {
    const { assistant, desk, conversation } = await fixture();
    await run(assistant, { visitorId: "visitor-1", conversationId: conversation.id, helpDeskId: desk.id });
    const updated = await db.getConversation(conversation.id);
    expect(updated?.metadata?.escalationRecommendedHelpDesk).toBeUndefined();
    expect(updated?.metadata?.escalationFollowedRecommendation).toBeUndefined();
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

describe("escalateConversation, Create a ticket channel (#1088, #1089)", () => {
  async function ticketFixture(options: { fullChatHistory?: boolean; chatSummary?: boolean } = {}) {
    const base = await fixture();
    const connection = await db.createApplicationConnection({
      organizationId: DEMO_ORG.id,
      provider: "salesforce",
      name: "Service org",
      sealedCredentials: "sealed",
    });
    await db.setTicketingTarget(base.desk.id, {
      provider: "salesforce",
      connectionId: connection.id,
    });
    const channel = await db.createSupportChannel(base.desk.id, {
      kind: "ticket",
      name: "Open a ticket",
      form: FORM,
      conversationData: { fullChatHistory: options.fullChatHistory ?? false, chatSummary: options.chatSummary ?? false },
    });
    return { ...base, connection, ticketChannel: channel };
  }

  function filer(outcomes: TicketFilingOutcome[]) {
    const calls: Array<{ target: TicketingTarget; draft: TicketDraft }> = [];
    const file = async (target: TicketingTarget, draft: TicketDraft) => {
      calls.push({ target, draft });
      return outcomes[Math.min(calls.length - 1, outcomes.length - 1)];
    };
    return { file, calls };
  }

  const FILED: TicketFilingOutcome = {
    ok: true,
    ticket: {
      provider: "salesforce",
      id: "500Ws00000AbCdEIAV",
      number: "00001026",
      url: "https://acme.my.salesforce.com/lightning/r/Case/500Ws00000AbCdEIAV/view",
    },
  };
  const REFUSED: TicketFilingOutcome = {
    ok: false,
    error: {
      provider: "salesforce",
      code: "provider",
      message: "INSUFFICIENT_ACCESS_OR_READONLY: insufficient access rights",
      status: 403,
    },
  };

  it("files one Case with the requested summary and transcript, and records it on the Conversation", async () => {
    const { assistant, desk, conversation, connection, ticketChannel } = await ticketFixture({
      fullChatHistory: true,
      chatSummary: true,
    });
    const { file, calls } = filer([FILED]);
    const outcome = await escalateConversation({
      db,
      assistantId: assistant.id,
      assistant,
      request: {
        requestId: "ticket-1",
        visitorId: "visitor-1",
        conversationId: conversation.id,
        helpDeskId: desk.id,
        channelId: ticketChannel.id,
        fields: FILLED,
      },
      ticketFiler: file,
      summarise: async () => "The Visitor needs help with unreliable wifi.",
    });
    expect(outcome).toEqual({ kind: "ok", email: undefined, ticket: { number: "00001026", url: FILED.ok ? FILED.ticket.url : "", conversationId: conversation.id } });
    expect(calls).toHaveLength(1);
    expect(calls[0].target).toEqual({ provider: "salesforce", connectionId: connection.id });
    expect(calls[0].draft).toMatchObject({
      subject: "Wifi down",
      requesterEmail: "visitor@example.com",
    });
    expect(calls[0].draft.description).toContain("It drops every few minutes.");
    expect(calls[0].draft.description).toContain("User: The wifi keeps dropping");
    expect(calls[0].draft.description).toContain("Chat summary ---\nThe Visitor needs help with unreliable wifi.");
    const metadata = (await db.getConversation(conversation.id))?.metadata;
    expect(metadata).toMatchObject({
      escalated: true,
      escalationOption: "Open a ticket",
      escalationTicket: FILED.ok ? FILED.ticket : undefined,
    });
  });

  it("rejects oversized combined ticket content before claiming and accepts a corrected submission", async () => {
    const { assistant, desk, conversation, ticketChannel } = await ticketFixture({ chatSummary: true, fullChatHistory: true });
    const { file, calls } = filer([FILED]);
    const submit = (description: string) => escalateConversation({
      db, assistantId: assistant.id, assistant, ticketFiler: file, summarise: async () => "The Visitor needs wifi help.",
      request: { requestId: "ticket-size-validation", visitorId: "visitor-1", conversationId: conversation.id, helpDeskId: desk.id, channelId: ticketChannel.id, fields: { ...FILLED, description } },
    });
    expect(await submit("x".repeat(32_000))).toMatchObject({ kind: "ticket_invalid", message: expect.stringMatching(/too long/i) });
    expect(calls).toHaveLength(0);
    expect((await db.getConversation(conversation.id))?.metadata?.escalated).not.toBe(true);
    expect((await submit("The wifi keeps dropping.")).kind).toBe("ok");
    expect(calls).toHaveLength(1);
    expect(calls[0].draft.description).toContain("The Visitor needs wifi help.");
    expect(calls[0].draft.description).toContain("--- Conversation ---");
  });

  it("retains a ticket Conversation before the first message, with its record link across retries", async () => {
    const { assistant, desk, ticketChannel } = await ticketFixture();
    const { file, calls } = filer([FILED]);
    const input = {
      db, assistantId: assistant.id, assistant, ticketFiler: file,
      request: { requestId: "ticket-before-chat", visitorId: "visitor-before-chat", helpDeskId: desk.id, channelId: ticketChannel.id, fields: FILLED },
    };
    const first = await escalateConversation(input);
    const retry = await escalateConversation(input);
    const conversations = await db.listConversations(assistant.id, "visitor", "visitor-before-chat");
    expect(conversations).toHaveLength(1);
    expect(conversations[0].metadata).toMatchObject({ escalated: true, escalationTicket: FILED.ok ? FILED.ticket : undefined });
    expect(first).toMatchObject({ kind: "ok", ticket: { conversationId: conversations[0].id, number: "00001026", url: FILED.ok ? FILED.ticket.url : "" } });
    expect(retry).toEqual(first);
    expect(calls).toHaveLength(1);
  });

  it("files nothing twice when the Widget retries the same request", async () => {
    const { assistant, desk, conversation, ticketChannel } = await ticketFixture();
    const { file, calls } = filer([FILED]);
    const submit = () =>
      escalateConversation({
        db,
        assistantId: assistant.id,
        assistant,
        request: {
          requestId: "ticket-retry",
          visitorId: "visitor-1",
          conversationId: conversation.id,
          helpDeskId: desk.id,
          channelId: ticketChannel.id,
          fields: FILLED,
        },
        ticketFiler: file,
      });
    const first = await submit();
    const second = await submit();
    expect(calls).toHaveLength(1);
    expect(second).toEqual(first);
  });

  it("returns a filed ticket when its replay transcript has grown beyond the provider limit", async () => {
    const { assistant, desk, conversation, ticketChannel } = await ticketFixture({ fullChatHistory: true });
    const { file, calls } = filer([FILED]);
    const submit = () => escalateConversation({
      db, assistantId: assistant.id, assistant, ticketFiler: file,
      request: { requestId: "filed-ticket-grown-transcript", visitorId: "visitor-1", conversationId: conversation.id, helpDeskId: desk.id, channelId: ticketChannel.id, fields: FILLED },
    });
    const first = await submit();
    expect(first.kind).toBe("ok");
    await db.appendMessage({ conversationId: conversation.id, role: "user", content: [{ type: "text", text: "x".repeat(32_000) }] });
    expect(await submit()).toEqual(first);
    expect(calls).toHaveLength(1);
  });

  it("does not attach a replayed ticket to a different Conversation", async () => {
    const { assistant, desk, conversation, ticketChannel } = await ticketFixture();
    const other = await db.createConversation({ assistantId: assistant.id, subjectType: "visitor", subjectId: "visitor-1", title: "Another topic" });
    const { file, calls } = filer([FILED]);
    const submit = (conversationId: string) => escalateConversation({
      db, assistantId: assistant.id, assistant, ticketFiler: file,
      request: { requestId: "same-submission-other-thread", visitorId: "visitor-1", conversationId, helpDeskId: desk.id, channelId: ticketChannel.id, fields: FILLED },
    });
    expect((await submit(conversation.id)).kind).toBe("ok");
    expect(await submit(other.id)).toEqual({ kind: "ticket_failed" });
    expect((await db.getConversation(other.id))?.metadata?.escalated).not.toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("keeps a concurrent retry pending and never marks a refused ticket escalated", async () => {
    const { assistant, desk, conversation, ticketChannel } = await ticketFixture();
    let complete: (outcome: TicketFilingOutcome) => void = () => {};
    let entered: () => void = () => {};
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const ticketFiler = vi.fn(() => new Promise<TicketFilingOutcome>((resolve) => {
      complete = resolve;
      entered();
    }));
    const input = {
      db, assistantId: assistant.id, assistant, ticketFiler,
      request: {
        requestId: "concurrent-ticket", visitorId: "visitor-1", conversationId: conversation.id,
        helpDeskId: desk.id, channelId: ticketChannel.id, fields: FILLED,
      },
    };
    const first = escalateConversation(input);
    await started;
    const retry = await escalateConversation(input);
    const beforeCompletion = (await db.getConversation(conversation.id))?.metadata?.escalated;
    complete(REFUSED);
    expect(await first).toEqual({ kind: "ticket_failed" });
    expect(retry).toEqual({ kind: "ticket_pending" });
    expect(beforeCompletion).not.toBe(true);
    expect((await db.getConversation(conversation.id))?.metadata?.escalated).not.toBe(true);
    expect(ticketFiler).toHaveBeenCalledTimes(1);
  });

  it("tells the Visitor nothing was filed, leaves the Conversation unflagged, and raises an Alert", async () => {
    const { assistant, desk, conversation, connection, ticketChannel } = await ticketFixture();
    const { file, calls } = filer([REFUSED, FILED]);
    const submit = (requestId: string) =>
      escalateConversation({
        db,
        assistantId: assistant.id,
        assistant,
        request: {
          requestId,
          visitorId: "visitor-1",
          conversationId: conversation.id,
          helpDeskId: desk.id,
          channelId: ticketChannel.id,
          fields: FILLED,
        },
        ticketFiler: file,
      });

    expect(await submit("ticket-refused")).toEqual({ kind: "ticket_failed" });
    expect((await db.getConversation(conversation.id))?.metadata?.escalated).not.toBe(true);
    const active = (await db.listActiveAlerts(DEMO_ORG.id, 100)).filter(
      (alert) => alert.sourceKey === ticketingAlertKey(connection.id)
    );
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ type: "integration" });
    expect(active[0].detail).toContain('"Service org"');
    expect(active[0].detail).toContain("INSUFFICIENT_ACCESS_OR_READONLY");

    // A replay never repeats a provider write, even after a lost response.
    expect(await submit("ticket-refused")).toEqual({ kind: "ticket_failed" });
    expect(calls).toHaveLength(1);
    // A separate submission can file and clear the connection's Alert.
    expect(await submit("ticket-new")).toMatchObject({ kind: "ok", ticket: { number: "00001026" } });
    expect(calls).toHaveLength(2);
    expect(
      (await db.listActiveAlerts(DEMO_ORG.id, 100)).filter(
        (alert) => alert.sourceKey === ticketingAlertKey(connection.id)
      )
    ).toHaveLength(0);
  });

  it("refuses a ticket channel on a desk with no ticketing target", async () => {
    const { assistant, desk, conversation } = await fixture();
    const channel = await db.createSupportChannel(desk.id, {
      kind: "ticket",
      name: "Open a ticket",
      form: FORM,
    });
    const { file, calls } = filer([FILED]);
    const outcome = await escalateConversation({
      db,
      assistantId: assistant.id,
      assistant,
      request: {
        visitorId: "visitor-1",
        conversationId: conversation.id,
        helpDeskId: desk.id,
        channelId: channel.id,
        fields: FILLED,
      },
      ticketFiler: file,
    });
    expect(outcome).toEqual({ kind: "not_found" });
    expect(calls).toHaveLength(0);
  });
});

describe("the Live operator channel (#1083)", () => {
  async function liveFixture(availability?: Parameters<typeof db.createSupportChannel>[1]["availability"]) {
    const base = await fixture({ autoImprovements: true });
    const live = await db.createSupportChannel(base.desk.id, {
      kind: "live_operator",
      name: "Talk to a person",
      config: { waitTimeoutMinutes: 7 },
      form: [{ id: "topic", type: "short_text", label: "Topic", showInForm: true }],
      ...(availability ? { availability } : {}),
    });
    // Staffed and Available (#1084): otherwise the channel is not offered.
    await db.table("helpDeskOperators").insert({
      organizationId: DEMO_ORG.id,
      helpDeskId: base.desk.id,
      memberId: DEMO_MEMBER.userId,
    });
    const [presence] = await db.table("operatorPresence").list({ organizationId: DEMO_ORG.id, memberId: DEMO_MEMBER.userId });
    if (presence) await db.table("operatorPresence").update(presence.id, { status: "available" });
    else await db.table("operatorPresence").insert({ organizationId: DEMO_ORG.id, memberId: DEMO_MEMBER.userId, status: "available" });
    return { ...base, live };
  }

  it("is refused while nobody on the desk is Available, and assigns the operator when somebody is (#1084)", async () => {
    const { assistant, desk, live, conversation } = await liveFixture();
    const unstaffed = await db.createHelpDesk(DEMO_ORG.id, { name: "Empty desk" });
    const lonely = await db.createSupportChannel(unstaffed.id, { kind: "live_operator", name: "Talk to a person" });
    expect(
      await run(assistant, { visitorId: "visitor-1", conversationId: conversation.id, helpDeskId: unstaffed.id, channelId: lonely.id })
    ).toEqual({ kind: "not_found" });

    const outcome = await run(assistant, {
      visitorId: "visitor-1",
      conversationId: conversation.id,
      helpDeskId: desk.id,
      channelId: live.id,
    });
    expect(outcome.kind).toBe("ok");
    expect((await db.getConversation(conversation.id))?.operator?.assignedMemberId).toBe(DEMO_MEMBER.userId);
  });

  it("puts the Conversation in a waiting state, records the escalation and fires the auto-Improvement", async () => {
    const { assistant, desk, live, conversation } = await liveFixture();
    const before = (await db.listImprovements(DEMO_ORG.id)).length;
    const now = new Date("2026-10-21T10:00:00.000Z");
    const outcome = await escalateConversation({
      db,
      assistantId: assistant.id,
      assistant,
      now,
      request: {
        visitorId: "visitor-1",
        conversationId: conversation.id,
        helpDeskId: desk.id,
        channelId: live.id,
        fields: { topic: "Billing" },
      },
    });
    expect(outcome).toEqual({
      kind: "ok",
      email: undefined,
      waiting: { conversationId: conversation.id, expiresAt: "2026-10-21T10:07:00.000Z" },
    });
    const stored = await db.getConversation(conversation.id);
    expect(stored?.operator).toMatchObject({ state: "waiting", waitingHelpDeskId: desk.id, waitingChannelId: live.id, waitTimeoutMinutes: 7 });
    expect(stored?.metadata).toMatchObject({
      escalated: true,
      escalationHelpDesk: "IT Desk",
      escalationOption: "Talk to a person",
      operatorRequestFields: [{ label: "Topic", value: "Billing" }],
    });
    expect((await db.listImprovements(DEMO_ORG.id)).length).toBe(before + 1);
  });

  it("does not restart a wait that is still on when the request is retried", async () => {
    const { assistant, desk, live, conversation } = await liveFixture();
    const request = { visitorId: "visitor-1", conversationId: conversation.id, helpDeskId: desk.id, channelId: live.id };
    const first = await escalateConversation({ db, assistantId: assistant.id, assistant, request, now: new Date("2026-10-21T10:00:00.000Z") });
    const retry = await escalateConversation({ db, assistantId: assistant.id, assistant, request, now: new Date("2026-10-21T10:03:00.000Z") });
    expect(first.kind === "ok" && first.waiting?.expiresAt).toBe("2026-10-21T10:07:00.000Z");
    expect(retry.kind === "ok" && retry.waiting?.expiresAt).toBe("2026-10-21T10:07:00.000Z");
  });

  it("starts a Conversation when the Visitor asks for a person before writing", async () => {
    const { assistant, desk, live } = await liveFixture();
    const outcome = await run(assistant, {
      visitorId: "visitor-fresh",
      helpDeskId: desk.id,
      channelId: live.id,
    });
    expect(outcome.kind).toBe("ok");
    const id = outcome.kind === "ok" ? outcome.waiting?.conversationId : undefined;
    expect(id).toBeTruthy();
    const created = await db.getConversation(id!);
    expect(created).toMatchObject({ subjectId: "visitor-fresh", operator: { state: "waiting" } });
  });

  it("is refused outside its Availability, like every other channel", async () => {
    const closed = {
      mode: "limited" as const,
      timezone: "UTC",
      hours: Object.fromEntries(
        ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((day) => [
          day,
          { enabled: false, ranges: [] },
        ])
      ) as never,
    };
    const { assistant, desk, live, conversation } = await liveFixture(closed);
    const outcome = await run(assistant, {
      visitorId: "visitor-1",
      conversationId: conversation.id,
      helpDeskId: desk.id,
      channelId: live.id,
    });
    expect(outcome).toEqual({ kind: "not_found" });
    expect((await db.getConversation(conversation.id))?.operator?.state ?? "ai").toBe("ai");
  });
});

describe("the Chat summary (#1081)", () => {
  const summaryRequest = (ids: { desk: string; channel: string; conversation?: string }, requestId = "summary-1") => ({
    requestId,
    visitorId: "visitor-1",
    ...(ids.conversation ? { conversationId: ids.conversation } : {}),
    helpDeskId: ids.desk,
    channelId: ids.channel,
    fields: FILLED,
  });

  it("puts the summary above the form fields and before the transcript, and stores it", async () => {
    const { assistant, desk, channel, conversation } = await fixture();
    await db.updateSupportChannel(channel.id, {
      conversationData: { chatSummary: true, fullChatHistory: true },
    });
    const sent: EmailMessage[] = [];
    const summarise = vi.fn(async () => "The visitor's wifi keeps dropping. The assistant suggested forgetting the network.");
    await escalateConversation({
      db,
      assistantId: assistant.id,
      assistant,
      request: summaryRequest({ desk: desk.id, channel: channel.id, conversation: conversation.id }),
      transport: async (m) => (sent.push(m), { delivered: true } as const),
      summarise,
    });
    const body = sent[0]!.body;
    expect(summarise).toHaveBeenCalledTimes(1);
    expect(body).toContain("--- Summary ---\nThe visitor's wifi keeps dropping.");
    expect(body.indexOf("--- Summary ---")).toBeLessThan(body.indexOf("Description:"));
    expect(body.indexOf("Description:")).toBeLessThan(body.indexOf("--- Conversation ---"));
    expect((await db.getConversation(conversation.id))?.metadata.escalationSummary).toMatch(/wifi keeps dropping/);
  });

  it("sends it as a summary field to an API endpoint channel", async () => {
    const { assistant, desk, conversation } = await fixture();
    const endpoint = await db.createSupportChannel(desk.id, {
      kind: "api_endpoint",
      name: "Webhook",
      config: { url: "https://api.example.com/escalate" },
      form: FORM,
      conversationData: { chatSummary: true },
    });
    const payloads: unknown[] = [];
    await escalateConversation({
      db,
      assistantId: assistant.id,
      assistant,
      request: summaryRequest({ desk: desk.id, channel: endpoint.id, conversation: conversation.id }),
      endpointTransport: async (_config, payload) => {
        payloads.push(payload);
        return { ok: true, status: 200, bodyText: "{}", errorCode: null };
      },
      summarise: async () => "Short summary.",
    });
    expect(payloads[0]).toMatchObject({ summary: "Short summary." });
    expect(payloads[0]).not.toHaveProperty("summaryNote");
  });

  it("reuses the stored summary on a retried escalation instead of calling the model again", async () => {
    const { assistant, desk, channel, conversation } = await fixture();
    await db.updateSupportChannel(channel.id, { conversationData: { chatSummary: true } });
    const summarise = vi.fn(async () => "First summary.");
    const sent: EmailMessage[] = [];
    const send = () =>
      escalateConversation({
        db,
        assistantId: assistant.id,
        assistant,
        request: summaryRequest({ desk: desk.id, channel: channel.id, conversation: conversation.id }, "retry-1"),
        transport: async (m) => (sent.push(m), { delivered: true } as const),
        summarise,
      });
    await send();
    await send();
    expect(summarise).toHaveBeenCalledTimes(1);
    expect(sent.map((m) => m.body.includes("First summary."))).toEqual([true, true]);
  });

  it("still escalates, saying so in one line, when the summary cannot be produced", async () => {
    const { assistant, desk, channel, conversation } = await fixture();
    await db.updateSupportChannel(channel.id, { conversationData: { chatSummary: true } });
    const sent: EmailMessage[] = [];
    const outcome = await escalateConversation({
      db,
      assistantId: assistant.id,
      assistant,
      request: summaryRequest({ desk: desk.id, channel: channel.id, conversation: conversation.id }),
      transport: async (m) => (sent.push(m), { delivered: true } as const),
      summarise: async () => {
        throw new Error("provider down");
      },
    });
    expect(outcome.kind).toBe("ok");
    expect(sent[0]!.body).toContain("Summary unavailable");
    expect(sent[0]!.body).not.toContain("--- Summary ---");

    const endpoint = await db.createSupportChannel(desk.id, {
      kind: "api_endpoint",
      name: "Webhook",
      config: { url: "https://api.example.com/escalate" },
      conversationData: { chatSummary: true },
    });
    const payloads: unknown[] = [];
    await escalateConversation({
      db,
      assistantId: assistant.id,
      assistant,
      request: summaryRequest({ desk: desk.id, channel: endpoint.id, conversation: conversation.id }, "api-fail"),
      endpointTransport: async (_config, payload) => {
        payloads.push(payload);
        return { ok: true, status: 200, bodyText: "{}", errorCode: null };
      },
      summarise: async () => null,
    });
    expect(payloads[0]).toMatchObject({ summary: null, summaryNote: "Summary unavailable" });
  });

  it("carries no summary for an escalation made before the Visitor wrote anything", async () => {
    const { assistant, desk, channel } = await fixture();
    await db.updateSupportChannel(channel.id, { conversationData: { chatSummary: true } });
    const quiet = await db.createConversation({
      assistantId: assistant.id,
      subjectType: "visitor",
      subjectId: "visitor-1",
      title: "Opened only",
    });
    const summarise = vi.fn(async () => "Should not be asked.");
    const sent: EmailMessage[] = [];
    await escalateConversation({
      db,
      assistantId: assistant.id,
      assistant,
      request: summaryRequest({ desk: desk.id, channel: channel.id, conversation: quiet.id }),
      transport: async (m) => (sent.push(m), { delivered: true } as const),
      summarise,
    });
    expect(summarise).not.toHaveBeenCalled();
    expect(sent[0]!.body).not.toContain("Summary");
  });
});
