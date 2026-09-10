import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHANNEL_CHAIN_TEAMMATE_TURN_CAP,
  CHANNEL_CHAIN_TURN_CAP,
  type ChannelMessage,
  type ChannelRosterEntry,
  type ProviderConnection,
  type Teammate,
  type TeammateChannel,
} from "@agent-hub/core";
import {
  registerEnterpriseCapabilities,
  resetEnterpriseCapabilities,
} from "./ee";
import type { Db } from "@agent-hub/db";
import {
  streamChannelChain,
  type ChannelTurnRunner,
} from "./channel-turn";
import { teammateMemorySections } from "./teammate-answer";
import type { ChannelEvent, ChatReplyPart, RuntimeEvent } from "./types";

/**
 * The chain, asserted without a model.
 *
 * `runTurn` is injected, so what these cases exercise is the part that has to
 * hold whatever the models say: who speaks, in what order, how far a fan-out
 * gets, and what the transcript keeps when a cap stops it. The turn itself (the
 * persona layer, the search, the granted actions) is the same engine call the
 * 1:1 chat makes and is covered where that is.
 */

const ORG = "org-1";
const CHANNEL_ID = "chan-1";

function teammate(id: string, name: string): Teammate {
  return {
    id,
    organizationId: ORG,
    ownerId: "m-ada",
    name,
    title: "",
    roleDescription: "",
    avatarSeed: "",
    editorIds: [],
    visibility: "org",
    collectionIds: [],
    sourceIds: [],
    modelProvider: "anthropic",
    modelId: "claude-opus-4-8",
    capabilityCeiling: "edit",
    systemKind: null,
    assistantId: null,
    approvalBypass: false,
    projectId: null,
    deletedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

const SAM = teammate("t-sam", "Sam");
const NORA = teammate("t-nora", "Nora");
const ADA_CHANNEL: TeammateChannel = {
  id: CHANNEL_ID,
  organizationId: ORG,
  name: "Launch week",
  projectId: null,
  createdBy: "m-ada",
  createdAt: "2026-08-24T09:00:00.000Z",
  updatedAt: "2026-08-24T09:00:00.000Z",
};

const ROSTER: ChannelRosterEntry[] = [
  { id: "m-ada", name: "Ada", kind: "member" },
  { id: SAM.id, name: SAM.name, kind: "teammate" },
  { id: NORA.id, name: NORA.name, kind: "teammate" },
];

/** A Db that holds one channel's transcript and nothing else. */
function fakeDb() {
  const messages: ChannelMessage[] = [];
  let seq = 0;
  const db = {
    async appendChannelMessage(input: {
      organizationId: string;
      channelId: string;
      authorType: ChannelMessage["authorType"];
      authorUserId?: string | null;
      authorTeammateId?: string | null;
      content: unknown[];
      mentions?: string[];
      chainId?: string | null;
    }) {
      seq += 1;
      const message: ChannelMessage = {
        id: `msg-${seq}`,
        organizationId: input.organizationId,
        channelId: input.channelId,
        authorType: input.authorType,
        authorUserId: input.authorUserId ?? null,
        authorTeammateId: input.authorTeammateId ?? null,
        content: input.content,
        mentions: input.mentions ?? [],
        chainId: input.chainId ?? null,
        trace: null,
        createdAt: new Date(Date.UTC(2026, 7, 24, 10, 0, seq)).toISOString(),
      };
      messages.push(message);
      return message;
    },
    async listChannelMessages(channelId: string, limit = 100) {
      return messages.filter((m) => m.channelId === channelId).slice(-limit);
    },
    async listChannelChainMessages(channelId: string, chainId: string) {
      return messages.filter(
        (m) => m.channelId === channelId && m.chainId === chainId
      );
    },
  };
  return { db: db as unknown as Db, messages };
}

/**
 * A Db over the channel plus a blocking daily budget, for the one case where
 * nobody is allowed to answer. `raiseAlert` is part of the budget check's own
 * behaviour (it tells an admin why answers stopped), so the fake has to accept
 * it or the check fails open and the case proves nothing.
 */
function overBudgetDb() {
  const { db, messages } = fakeDb();
  const alerts: { title: string }[] = [];
  Object.assign(db, {
    async getOrgBudget() {
      return { dailyTokenLimit: 1000, dailyEuroLimit: null, enforcement: "block" };
    },
    async getOrgTokensUsedToday() {
      return 5000;
    },
    async getOrgCostUsedToday() {
      return 0;
    },
    async raiseAlert(_org: string, alert: { title: string }) {
      alerts.push(alert);
      return alert;
    },
  });
  return { db, messages, alerts };
}

/** Says `text`, which may mention colleagues by name. */
function saying(text: (teammateName: string) => string): ChannelTurnRunner {
  return async ({ teammate: speaker }) => ({
    parts: [
      { type: "text", action: "search_knowledge", text: text(speaker.name) },
    ] as ChatReplyPart[],
    trace: null,
  });
}

async function runChain(args: {
  targets: string[];
  runTurn: ChannelTurnRunner;
  teammates?: Teammate[];
  connections?: ProviderConnection[];
}) {
  const { db, messages } = fakeDb();
  const startMessage = await db.appendChannelMessage({
    organizationId: ORG,
    channelId: CHANNEL_ID,
    authorType: "member",
    authorUserId: "m-ada",
    content: [{ type: "text", text: "who broke the crawl?" }],
    mentions: args.targets,
  });
  const stream = await streamChannelChain({
    db,
    organizationId: ORG,
    channel: ADA_CHANNEL,
    roster: ROSTER,
    teammates: args.teammates ?? [SAM, NORA],
    connections: args.connections ?? [],
    startMessage,
    startedBy: { userId: "m-ada", name: "Ada" },
    targets: args.targets,
    runTurn: args.runTurn,
    signal: new AbortController().signal,
  });

  const text = await new Response(stream).text();
  const events = text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as RuntimeEvent | ChannelEvent);
  return { events, messages, startMessage, db };
}

/**
 * Run the same chain again, against the transcript the first run left behind.
 *
 * What a retry looks like from the runtime's side: the caps are re-derived from
 * the persisted messages rather than carried over in a counter, so this is the
 * only way to assert that they are.
 */
async function resumeChain(args: {
  db: Db;
  startMessage: ChannelMessage;
  targets: string[];
  runTurn: ChannelTurnRunner;
}) {
  const stream = await streamChannelChain({
    db: args.db,
    organizationId: ORG,
    channel: ADA_CHANNEL,
    roster: ROSTER,
    teammates: [SAM, NORA],
    connections: [],
    startMessage: args.startMessage,
    startedBy: { userId: "m-ada", name: "Ada" },
    targets: args.targets,
    runTurn: args.runTurn,
    signal: new AbortController().signal,
  });
  const text = await new Response(stream).text();
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as RuntimeEvent | ChannelEvent);
}

const speakers = (events: (RuntimeEvent | ChannelEvent)[]) =>
  events
    .filter((e): e is Extract<ChannelEvent, { type: "channel-speaker" }> =>
      e.type === "channel-speaker"
    )
    .map((e) => e.teammateName);

const endEvent = (events: (RuntimeEvent | ChannelEvent)[]) =>
  events.find(
    (e): e is Extract<ChannelEvent, { type: "channel-end" }> =>
      e.type === "channel-end"
  );

describe("the channel chain", () => {
  it("runs one turn per mentioned teammate, and none for the others", async () => {
    const { events, messages, startMessage } = await runChain({
      targets: [SAM.id],
      runTurn: saying((name) => `${name} here, the crawler timed out.`),
    });

    expect(speakers(events)).toEqual(["Sam"]);
    // Nora sat in the channel and was not mentioned, so Nora said nothing:
    // mention-only is the whole activation rule (#775).
    const replies = messages.filter((m) => m.authorType === "teammate");
    expect(replies).toHaveLength(1);
    expect(replies[0].authorTeammateId).toBe(SAM.id);
    expect(replies[0].chainId).toBe(startMessage.id);
    expect(endEvent(events)).toMatchObject({ turns: 1, capped: null });
  });

  it("fans out to three teammates from one message", async () => {
    const three = [SAM, NORA, teammate("t-ilya", "Ilya")];
    const { events, messages } = await runChain({
      targets: three.map((t) => t.id),
      teammates: three,
      runTurn: saying((name) => `${name} reporting.`),
    });

    expect(speakers(events)).toEqual(["Sam", "Nora", "Ilya"]);
    expect(messages.filter((m) => m.authorType === "teammate")).toHaveLength(3);
    expect(endEvent(events)?.turns).toBe(3);
  });

  it("lets a teammate pull in a colleague, who then answers on its own", async () => {
    const { events, messages } = await runChain({
      targets: [SAM.id],
      runTurn: async ({ teammate: speaker }) => ({
        parts: [
          {
            type: "text",
            action: "search_knowledge",
            text:
              speaker.id === SAM.id
                ? "That is scheduling, @Nora can you take it?"
                : "On it.",
          },
        ] as ChatReplyPart[],
        trace: null,
      }),
    });

    expect(speakers(events)).toEqual(["Sam", "Nora"]);
    const handoff = messages.find((m) => m.authorTeammateId === SAM.id);
    expect(handoff!.mentions).toEqual([NORA.id]);
    // Both replies belong to the one chain the human message opened.
    expect(
      messages
        .filter((m) => m.authorType === "teammate")
        .every((m) => m.chainId === "msg-1")
    ).toBe(true);
  });

  it("never reaches a teammate outside the channel", async () => {
    const { events, messages } = await runChain({
      targets: [SAM.id],
      // The model names somebody who is not seated here. Nothing resolves, so
      // nothing runs: the channel is the perimeter (#775).
      runTurn: saying(() => "@Scheduler should own this, and @Assistant too."),
    });

    expect(speakers(events)).toEqual(["Sam"]);
    expect(messages.find((m) => m.authorTeammateId === SAM.id)!.mentions).toEqual(
      []
    );
  });

  it("ignores a self-mention rather than spending a turn on it", async () => {
    const { events } = await runChain({
      targets: [SAM.id],
      runTurn: saying((name) => `@${name} will look into it.`),
    });
    expect(speakers(events)).toEqual(["Sam"]);
  });

  it("stops at the chain cap and says so in the transcript", async () => {
    // Two teammates volleying: Sam names Nora, Nora names Sam, forever.
    const { events, messages } = await runChain({
      targets: [SAM.id],
      runTurn: async ({ teammate: speaker }) => ({
        parts: [
          {
            type: "text",
            action: "search_knowledge",
            text: speaker.id === SAM.id ? "@Nora?" : "@Sam?",
          },
        ] as ChatReplyPart[],
        trace: null,
      }),
    });

    // The per-teammate cap bites first with only two of them in the volley:
    // four turns, then each is refused a third.
    const replies = messages.filter((m) => m.authorType === "teammate");
    expect(replies.length).toBe(CHANNEL_CHAIN_TEAMMATE_TURN_CAP * 2);
    expect(replies.length).toBeLessThan(CHANNEL_CHAIN_TURN_CAP);
    const markers = messages.filter((m) => m.authorType === "system");
    expect(markers.length).toBeGreaterThan(0);
    expect(JSON.stringify(markers[0].content)).toContain("already replied");
    expect(endEvent(events)?.capped).toBe("teammate_cap");
  });

  it("never runs an eleventh teammate turn", async () => {
    // Enough teammates that no single one hits its own cap: only the chain cap
    // can stop this, and it has to.
    const crowd = Array.from({ length: 12 }, (_, i) =>
      teammate(`t-${i}`, `Agent${i}`)
    );
    const roster: ChannelRosterEntry[] = [
      { id: "m-ada", name: "Ada", kind: "member" },
      ...crowd.map((t) => ({
        id: t.id,
        name: t.name,
        kind: "teammate" as const,
      })),
    ];
    const { db, messages } = fakeDb();
    const startMessage = await db.appendChannelMessage({
      organizationId: ORG,
      channelId: CHANNEL_ID,
      authorType: "member",
      authorUserId: "m-ada",
      content: [{ type: "text", text: "everyone, status?" }],
      mentions: crowd.map((t) => t.id),
    });
    const stream = await streamChannelChain({
      db,
      organizationId: ORG,
      channel: ADA_CHANNEL,
      roster,
      teammates: crowd,
      connections: [],
      startMessage,
      startedBy: { userId: "m-ada", name: "Ada" },
      targets: crowd.map((t) => t.id),
      runTurn: saying((name) => `${name} is fine.`),
      signal: new AbortController().signal,
    });
    const events = (await new Response(stream).text())
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as RuntimeEvent | ChannelEvent);

    expect(speakers(events)).toHaveLength(CHANNEL_CHAIN_TURN_CAP);
    expect(messages.filter((m) => m.authorType === "teammate")).toHaveLength(
      CHANNEL_CHAIN_TURN_CAP
    );
    const marker = messages.find((m) => m.authorType === "system");
    expect(JSON.stringify(marker!.content)).toContain("Chain cap reached");
    expect(endEvent(events)).toMatchObject({
      turns: CHANNEL_CHAIN_TURN_CAP,
      capped: "chain_cap",
    });
  });

  it("counts the caps from the transcript, so a resumed chain cannot restart them", async () => {
    const { db, messages } = fakeDb();
    const startMessage = await db.appendChannelMessage({
      organizationId: ORG,
      channelId: CHANNEL_ID,
      authorType: "member",
      authorUserId: "m-ada",
      content: [{ type: "text", text: "@Sam again?" }],
      mentions: [SAM.id],
    });
    // Sam already answered twice in this chain (a first call that was
    // interrupted, a retry): the third must not run.
    for (const _ of Array.from({ length: CHANNEL_CHAIN_TEAMMATE_TURN_CAP })) {
      await db.appendChannelMessage({
        organizationId: ORG,
        channelId: CHANNEL_ID,
        authorType: "teammate",
        authorTeammateId: SAM.id,
        content: [{ type: "text", text: "said already" }],
        chainId: startMessage.id,
      });
    }

    const stream = await streamChannelChain({
      db,
      organizationId: ORG,
      channel: ADA_CHANNEL,
      roster: ROSTER,
      teammates: [SAM, NORA],
      connections: [],
      startMessage,
      startedBy: { userId: "m-ada", name: "Ada" },
      targets: [SAM.id],
      runTurn: saying((name) => `${name} again.`),
      signal: new AbortController().signal,
    });
    const events = (await new Response(stream).text())
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as RuntimeEvent | ChannelEvent);

    expect(speakers(events)).toEqual([]);
    expect(endEvent(events)).toMatchObject({ turns: 0, capped: "teammate_cap" });
    expect(messages.filter((m) => m.authorType === "system")).toHaveLength(1);
  });

  it("hands a turn the message it must answer and the transcript around it", async () => {
    const seen: { message: string; history: string[] }[] = [];
    await runChain({
      targets: [SAM.id],
      runTurn: async ({ trigger, history, teammate: speaker }) => {
        seen.push({
          message: (trigger.content as { text?: string }[])[0]?.text ?? "",
          history: history.map(
            (m) => (m.content as { text?: string }[])[0]?.text ?? ""
          ),
        });
        return {
          parts: [
            {
              type: "text",
              action: "search_knowledge",
              text: `${speaker.name} answered`,
            },
          ] as ChatReplyPart[],
          trace: null,
        };
      },
    });
    // Both, on purpose: the trigger says what to answer, and the transcript is
    // read after it was persisted, so it is in there too. Dropping the trigger
    // from the *model's* history is `modelChannelTurn`'s job, because a later
    // turn in the same chain has a different trigger while this message stays
    // part of the thread.
    expect(seen).toHaveLength(1);
    expect(seen[0].message).toBe("who broke the crawl?");
    expect(seen[0].history).toContain("who broke the crawl?");
  });

  it("runs nothing over the daily budget, and the transcript says why", async () => {
    const { db, messages, alerts } = overBudgetDb();
    const startMessage = await db.appendChannelMessage({
      organizationId: ORG,
      channelId: CHANNEL_ID,
      authorType: "member",
      authorUserId: "m-ada",
      content: [{ type: "text", text: "@Sam anything?" }],
      mentions: [SAM.id],
    });
    let ran = 0;
    const stream = await streamChannelChain({
      db,
      organizationId: ORG,
      channel: ADA_CHANNEL,
      roster: ROSTER,
      teammates: [SAM, NORA],
      connections: [],
      startMessage,
      startedBy: { userId: "m-ada", name: "Ada" },
      targets: [SAM.id],
      runTurn: async () => {
        ran += 1;
        return { parts: [], trace: null };
      },
      signal: new AbortController().signal,
    });
    const events = (await new Response(stream).text())
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as RuntimeEvent | ChannelEvent);

    expect(ran).toBe(0);
    expect(speakers(events)).toEqual([]);
    const marker = messages.find((m) => m.authorType === "system");
    expect(JSON.stringify(marker!.content)).toContain("daily AI budget");
    // The same Alert an over-budget Assistant turn raises: an admin has to be
    // able to find out why the answers stopped.
    expect(alerts.map((a) => a.title)).toContain("Daily AI budget reached");
    expect(endEvent(events)).toMatchObject({ turns: 0 });
  });

  it("keeps the fan-out going when one teammate's turn fails", async () => {
    const { events, messages, startMessage, db } = await runChain({
      targets: [SAM.id, NORA.id],
      runTurn: async ({ teammate: speaker, emit }) => {
        if (speaker.id === SAM.id) throw new Error("provider exploded");
        emit({ type: "notice", label: "Searching knowledge" });
        return {
          parts: [
            { type: "text", action: "search_knowledge", text: "Nora here." },
          ] as ChatReplyPart[],
          trace: null,
        };
      },
    });

    // Sam's provider died; Nora was asked too and still answered, and the
    // transcript says what happened to Sam rather than leaving a gap.
    expect(events.some((e) => e.type === "error")).toBe(true);
    expect(speakers(events)).toEqual(["Sam", "Nora"]);
    expect(messages.filter((m) => m.authorTeammateId === NORA.id)).toHaveLength(
      1
    );
    // Filed under Sam rather than under the runtime: it is Sam's turn that was
    // spent, and the transcript is where the next run reads that from.
    const marker = messages.find((m) => m.authorTeammateId === SAM.id);
    expect(JSON.stringify(marker!.content)).toContain("Could not answer");
    expect(messages.some((m) => m.authorType === "system")).toBe(false);
    expect(endEvent(events)).toMatchObject({ turns: 2 });

    // And it counts. Sam took one turn by failing, so a chain that resumes has
    // one left before its own cap, not two.
    const second = await resumeChain({
      db,
      startMessage,
      targets: [SAM.id],
      runTurn: saying(() => "Back up now."),
    });
    expect(speakers(second)).toEqual(["Sam"]);

    const third = await resumeChain({
      db,
      startMessage,
      targets: [SAM.id],
      runTurn: saying(() => "And again."),
    });
    expect(speakers(third)).toEqual([]);
    expect(endEvent(third)).toMatchObject({ turns: 0, capped: "teammate_cap" });
  });
});

describe("the chain's spend gate", () => {
  afterEach(() => {
    resetEnterpriseCapabilities();
    vi.unstubAllEnvs();
  });

  /** The org's own key for one provider. `plain:` is the test seal (models.test.ts). */
  function ownKeyFor(provider: "anthropic" | "openai"): ProviderConnection {
    return {
      id: `c-${provider}`,
      organizationId: ORG,
      type: "api_key",
      provider,
      displayName: provider,
      encryptedKey: "plain:k-123",
      keyHint: "â€¦abcd",
      config: {},
      createdBy: null,
      createdAt: "2026-08-01T00:00:00.000Z",
      preferredForEmbedding: false,
    } as ProviderConnection;
  }

  it("admits and settles every Teammate turn in a Chain", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "platform-key");
    const { db } = fakeDb();
    let reserved = 0;
    let settled = 0;
    let released = 0;
    let settledRows = 0;
    Object.assign(db, {
      async getOrgBudget() {
        return {
          dailyTokenLimit: 1_000_000,
          dailyEuroLimit: null,
          enforcement: "block",
        };
      },
      async getOrgTokensUsedToday() {
        return 0;
      },
      async getOrgCostUsedToday() {
        return 0;
      },
      async raiseAlert() {
        return {};
      },
      async resolveAlert() {},
      async reserveOrgBudget() {
        reserved += 1;
        return "chain-reservation";
      },
      async settleOrgBudgetReservation(_id: string, rows: unknown[]) {
        settled += 1;
        settledRows += rows.length;
        return true;
      },
      async releaseOrgBudgetReservation() {
        released += 1;
        return true;
      },
    });
    const startMessage = await db.appendChannelMessage({
      organizationId: ORG,
      channelId: CHANNEL_ID,
      authorType: "member",
      authorUserId: "m-ada",
      content: [{ type: "text", text: "@Sam @Nora status?" }],
      mentions: [SAM.id, NORA.id],
    });

    const stream = await streamChannelChain({
      db,
      organizationId: ORG,
      channel: ADA_CHANNEL,
      roster: ROSTER,
      teammates: [SAM, NORA],
      connections: [],
      startMessage,
      startedBy: { userId: "m-ada", name: "Ada" },
      targets: [SAM.id, NORA.id],
      runTurn: async ({ teammate: speaker }) => ({
        parts: [
          {
            type: "text",
            action: "search_knowledge",
            text: `${speaker.name} answered`,
          },
        ],
        trace: null,
        usage: [
          {
            organizationId: ORG,
            assistantId: null,
            conversationId: null,
            messageId: null,
            stage: "generate",
            provider: "anthropic",
            modelId: "claude-opus-4-8",
            credentialKind: "platform",
            inputTokens: 10,
            outputTokens: 5,
          },
        ],
      }),
      signal: new AbortController().signal,
    });
    await new Response(stream).text();

    expect(reserved).toBe(2);
    expect(settled).toBe(2);
    expect(settledRows).toBe(2);
    expect(released).toBe(0);
  });

  /**
   * A channel can seat a Teammate on the Platform's key beside one on the
   * organization's own, and the plan cap is metered per kind. Gating on the
   * first queued Teammate's kind, as this used to, checks a meter the chain is
   * not the only one spending.
   */
  it("checks the credential kind of a dynamically mentioned Teammate", async () => {
    const asked: string[] = [];
    registerEnterpriseCapabilities({
      metering: {
        async checkUsage({ connectionKind }) {
          asked.push(connectionKind);
          return connectionKind === "byok"
            ? {
                outcome: "block" as const,
                message: "This organization's own key is over its plan cap.",
              }
            : { outcome: "allow" as const };
        },
      },
    } as Parameters<typeof registerEnterpriseCapabilities>[0]);

    // Sam runs on the Platform's Anthropic key, Nora on the organization's own
    // OpenAI one, which is the mix the old gate could not see.
    vi.stubEnv("ANTHROPIC_API_KEY", "platform-key");
    const onPlatform = { ...SAM };
    const onOwnKey = {
      ...NORA,
      modelProvider: "openai" as const,
      modelId: "gpt-5.1",
    };
    const { events, messages } = await runChain({
      targets: [onPlatform.id],
      teammates: [onPlatform, onOwnKey],
      connections: [ownKeyFor("openai")],
      runTurn: saying((speaker) =>
        speaker === "Sam" ? "@Nora can take this." : "should never run",
      ),
    });

    expect([...asked].sort()).toEqual(["byok", "platform"]);
    expect(speakers(events)).toEqual(["Sam"]);
    const marker = messages.find((m) => m.authorType === "system");
    expect(JSON.stringify(marker!.content)).toContain("over its plan cap");
    expect(endEvent(events)).toMatchObject({ turns: 1 });
  });
});

describe("Channel turn telemetry", () => {
  it("records success only after the reply has been persisted", async () => {
    const { db, messages } = fakeDb();
    const startMessage = await db.appendChannelMessage({
      organizationId: ORG,
      channelId: CHANNEL_ID,
      authorType: "member",
      authorUserId: "m-ada",
      content: [{ type: "text", text: "@Sam status?" }],
      mentions: [SAM.id],
    });
    const recorded: string[] = [];
    const stream = await streamChannelChain({
      db,
      organizationId: ORG,
      channel: ADA_CHANNEL,
      roster: ROSTER,
      teammates: [SAM],
      connections: [],
      startMessage,
      startedBy: { userId: "m-ada", name: "Ada" },
      targets: [SAM.id],
      runTurn: async () => ({
        parts: [{ type: "text", action: "search_knowledge", text: "Done." }],
        trace: null,
        recordSucceeded: async (messageId) => {
          expect(messages.some((message) => message.id === messageId)).toBe(true);
          recorded.push(messageId);
        },
      }),
      signal: new AbortController().signal,
    });
    await new Response(stream).text();

    expect(recorded).toEqual(["msg-2"]);
  });

  it("does not record success when reply persistence fails", async () => {
    const { db } = fakeDb();
    const startMessage = await db.appendChannelMessage({
      organizationId: ORG,
      channelId: CHANNEL_ID,
      authorType: "member",
      authorUserId: "m-ada",
      content: [{ type: "text", text: "@Sam status?" }],
      mentions: [SAM.id],
    });
    const append = db.appendChannelMessage.bind(db);
    Object.assign(db, {
      async appendChannelMessage(
        input: Parameters<Db["appendChannelMessage"]>[0],
      ) {
        if (input.authorType === "teammate") throw new Error("write failed");
        return append(input);
      },
    });
    const recordSucceeded = vi.fn();
    const stream = await streamChannelChain({
      db,
      organizationId: ORG,
      channel: ADA_CHANNEL,
      roster: ROSTER,
      teammates: [SAM],
      connections: [],
      startMessage,
      startedBy: { userId: "m-ada", name: "Ada" },
      targets: [SAM.id],
      runTurn: async () => ({
        parts: [{ type: "text", action: "search_knowledge", text: "Done." }],
        trace: null,
        recordSucceeded,
      }),
      signal: new AbortController().signal,
    });
    await new Response(stream).text();

    expect(recordSucceeded).not.toHaveBeenCalled();
  });
});

describe("the memory layers a channel turn reads", () => {
  /** A Db with three documents and two Projects in it, and nothing else. */
  function memoryDb(over: { archived?: boolean } = {}) {
    const docs: Record<string, string> = {
      "user:m-ada": "Ada prefers short answers.",
      "user:m-bob": "Bob wants everything in a table.",
      "agent:t-sam": "Sam learned the crawler times out on Fridays.",
      "project:p-own": "Sam's own project decided to use pnpm.",
      "project:p-channel": "The channel's project decided to ship on Thursday.",
    };
    const projects: Record<string, { id: string; name: string; archived: boolean }> = {
      "p-own": { id: "p-own", name: "Sam's project", archived: false },
      "p-channel": {
        id: "p-channel",
        name: "Launch",
        archived: over.archived ?? false,
      },
    };
    const asked: string[] = [];
    const db = {
      async getMemoryDocument(
        _org: string,
        owner: { scope: string; memberId?: string; teammateId?: string; projectId?: string }
      ) {
        const key =
          owner.scope === "user"
            ? `user:${owner.memberId}`
            : owner.scope === "agent"
              ? `agent:${owner.teammateId}`
              : `project:${owner.projectId}`;
        asked.push(key);
        const body = docs[key];
        return body ? { body } : null;
      },
      table: (name: string) => ({
        get: async (id: string) => (name === "projects" ? projects[id] ?? null : null),
      }),
    };
    return { db: db as unknown as Db, asked };
  }

  it("reads the chain-starter's profile, and nobody else's", async () => {
    const { db, asked } = memoryDb();
    const sections = await teammateMemorySections(db, {
      teammate: SAM,
      memberId: "m-ada",
      sharedProjectId: ADA_CHANNEL.projectId,
    });
    expect(sections.join("\n")).toContain("Ada prefers short answers");
    // Bob is in the channel too, and his profile is his own business: a group
    // thread must not spread everyone's preferences into everyone's turns.
    expect(sections.join("\n")).not.toContain("Bob wants everything");
    expect(asked).not.toContain("user:m-bob");
  });

  it("injects the channel's project decisions beside the teammate's own", async () => {
    const { db } = memoryDb();
    const sections = await teammateMemorySections(db, {
      teammate: { ...SAM, projectId: "p-own" },
      memberId: "m-ada",
      sharedProjectId: "p-channel",
    });
    const rendered = sections.join("\n\n");
    expect(rendered).toContain("use pnpm");
    expect(rendered).toContain("ship on Thursday");
    // The thread's own project reads last, as the most specific context.
    expect(rendered.indexOf("ship on Thursday")).toBeGreaterThan(
      rendered.indexOf("use pnpm")
    );
  });

  it("says nothing for an archived channel project", async () => {
    const { db } = memoryDb({ archived: true });
    const sections = await teammateMemorySections(db, {
      teammate: SAM,
      memberId: "m-ada",
      sharedProjectId: "p-channel",
    });
    // Archiving keeps the decisions readable and stops them reaching a model.
    expect(sections.join("\n")).not.toContain("ship on Thursday");
  });

  it("injects nothing at all when every layer is empty", async () => {
    const { db } = memoryDb();
    // A colleague with no profile, a Teammate that has learned nothing, no
    // Project: empty layers inject nothing rather than three empty headings.
    expect(
      await teammateMemorySections(db, {
        teammate: { ...SAM, id: "t-fresh" },
        memberId: "m-nobody",
        sharedProjectId: ADA_CHANNEL.projectId,
      })
    ).toEqual([]);
  });
});
