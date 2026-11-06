import type {
  AiUsageInput,
  ProviderConnection,
  StoredTurnTrace,
  Teammate,
  UsageSpenders,
  UsageSurface,
} from "@agent-hub/core";
import {
  memoryPromptSections,
  projectInjects,
  teammateDefaultFlow,
  teammatePersonaPrompt,
  teammateRuntimeAssistant,
  teammateSearchesKnowledge,
  teammateRuntimeConfig,
} from "@agent-hub/core";
import type { Db } from "@agent-hub/db";

import { runAssistantChat } from "./engine";
import { buildCollectionSearcher } from "./retrieval";
import { errorClassOf, recordRuntimeEvent } from "./telemetry";
import { prepareTraceForStorage } from "./trace";
import { createTurnObserver } from "./turn-observer";
import { TurnClock, activeTurnClock, timedDb, withTurnClock } from "./turn-clock";
import type { ChatReplyPart, RuntimeEvent } from "./types";
import { summarizeTurnUsage } from "./usage";
import { runExternalTeammateHarness } from "./ag-ui";
import { teammateComputerTools } from "./teammate-computer";

type AssistantChatOptions = Parameters<typeof runAssistantChat>[0];

export type TeammateAnswerTurn = Omit<
  AssistantChatOptions,
  | "assistant"
  | "persona"
  | "flows"
  | "connections"
  | "searchKnowledge"
> & { userMessageId?: string };

/**
 * One AI Teammate answer, independent of the container that asked for it.
 *
 * A private Conversation and a Teammate Channel persist different records and
 * apply different continuation rules, but the answer itself has one identity,
 * one implicit Flow and one Knowledge Scope. Keeping those facts here prevents
 * the two adapters from rebuilding the Teammate runtime independently.
 */
export function runTeammateAnswer(options: {
  db: Db;
  systemDb?: Db;
  organizationId: string;
  teammate: Teammate;
  connections: ProviderConnection[];
  /** Conversation attribution for embeddings; null for a Channel. */
  conversationId: string | null;
  /** Container-specific prompt context, after the Standing Role. */
  personaContext?: string;
  turn: TeammateAnswerTurn;
  /** Who the Knowledge Scope search's embedding is spent by (#849). */
  usage?: { spenders?: UsageSpenders; surface?: UsageSurface };
}) {
  const {
    db,
    organizationId,
    teammate,
    connections,
    conversationId,
    personaContext,
    turn,
  } = options;
  const persona = [teammatePersonaPrompt(teammate), personaContext]
    .filter((section): section is string => Boolean(section?.trim()))
    .join("\n\n");

  if (teammateRuntimeConfig(teammate).harness.kind === "ag_ui") {
    return runExternalTeammateHarness({ teammate, turn, persona });
  }

  return runAssistantChat({
    ...turn,
    teammateActions: [...(turn.teammateActions ?? []), ...teammateComputerTools(db, teammate)],
    assistant: teammateRuntimeAssistant(teammate),
    persona,
    flows: [teammateDefaultFlow(teammate)],
    connections,
    searchKnowledge: teammateSearchesKnowledge(teammate)
      ? buildCollectionSearcher({
          db,
          systemDb: options.systemDb,
          connections,
          organizationId,
          collectionIds: teammate.collectionIds,
          sourceIds: teammate.sourceIds,
          conversationId,
          usage: options.usage,
        })
      : undefined,
  });
}

type TeammateEngineResult = Awaited<ReturnType<typeof runTeammateAnswer>>;

interface TeammateAnswerTelemetry {
  assistantId: string | null;
  conversationId: string | null;
  surface: "teammate";
  startedAt: number;
}

/**
 * Who this answer's credits are attributed to (#848).
 *
 * Separate from `TeammateAnswerTelemetry` above, whose `surface` names one of
 * the three *chat* surfaces a runtime event distinguishes: a Teammate answer is
 * also produced unattended and inside a channel, and folding those into
 * "teammate" would make a Routine's spend indistinguishable from a Member's.
 *
 * The Teammate itself is not a field here: this seam always runs one, and it is
 * already on `options.teammate`.
 */
interface TeammateAnswerAttribution {
  surface: UsageSurface;
  /** The Member whose turn this is, where the surface has one. */
  memberId?: string | null;
  /** The Routine driving this run, when one is (#849). */
  routineId?: string | null;
}

export type TeammateAnswerOutcome =
  | {
      ok: true;
      result: TeammateEngineResult;
      parts: ChatReplyPart[];
      trace: StoredTurnTrace | null;
      toolCalls: number;
      usageRows: (messageId: string | null) => AiUsageInput[];
      recordSucceeded: (messageId: string | null) => Promise<void>;
    }
  | {
      ok: false;
      error: unknown;
      toolCalls: number;
      usageRows: (messageId: string | null) => AiUsageInput[];
      recordFailed: () => Promise<void>;
    };

/**
 * One Teammate answer's model calls, projected onto AI usage ledger rows.
 *
 * Pure, and separate from the lifecycle below, because this is where the
 * attribution decision lives (#848): the Teammate that ran always, the Member
 * who asked only where the surface has one. Unattended work names no Member
 * rather than borrowing an arbitrary one, which is the difference between "a
 * Routine spent this" and "a colleague spent this".
 *
 * Internal to the package: the barrel publishes the lifecycle, not its parts.
 */
export function projectTeammateUsage(input: {
  usage: TeammateEngineResult["usage"];
  organizationId: string;
  teammateId: string;
  telemetry: Pick<TeammateAnswerTelemetry, "assistantId" | "conversationId">;
  attribution: TeammateAnswerAttribution;
  messageId: string | null;
}): AiUsageInput[] {
  return input.usage.map((event) => ({
    organizationId: input.organizationId,
    assistantId: input.telemetry.assistantId,
    conversationId: input.telemetry.conversationId,
    messageId: input.messageId,
    stage: event.stage,
    provider: event.provider,
    modelId: event.modelId,
    credentialKind: event.credentialKind,
    inputTokens: event.inputTokens,
    outputTokens: event.outputTokens,
    cacheReadTokens: event.cacheReadTokens,
    cacheWriteTokens: event.cacheWriteTokens,
    spenders: {
      teammateId: input.teammateId,
      memberId: input.attribution.memberId ?? null,
      routineId: input.attribution.routineId ?? null,
    },
    surface: input.attribution.surface,
  }));
}

/**
 * The complete model-backed Teammate answer lifecycle shared by Conversation
 * and Channel adapters. Containers still own persistence and continuation;
 * this seam owns execution, public event projection, trace/audit folding,
 * usage projection and the telemetry facts derived from the answer.
 */
export async function executeTeammateAnswer(
  options: TeammateAnswerOptions
): Promise<TeammateAnswerOutcome> {
  // A Conversation turn already runs under its own clock. A Channel answer
  // does not, so it opens one here and its telemetry carries the summary
  // explicitly: the container records it after this scope has ended (#1112).
  if (activeTurnClock()?.kind === "turn") return answerTeammate(options, null);
  const clock = new TurnClock(performance.now() - (Date.now() - options.telemetry.startedAt));
  clock.trigger = "channel";
  const forward = options.forward;
  const clocked: TeammateAnswerOptions = {
    ...options,
    db: timedDb(options.db),
    ...(options.systemDb ? { systemDb: timedDb(options.systemDb) } : {}),
    forward: (event) => {
      if (event.type === "text-delta" || event.type === "part") clock.markFirstToken();
      forward(event);
    },
  };
  return withTurnClock(clock, () => answerTeammate(clocked, clock));
}

interface TeammateAnswerOptions {
  db: Db;
  /** Internal accounting and audit writes; data access remains on `db`. */
  systemDb?: Db;
  organizationId: string;
  teammate: Teammate;
  connections: ProviderConnection[];
  conversationId: string | null;
  personaContext?: string;
  turn: TeammateAnswerTurn;
  forward: (event: RuntimeEvent) => void;
  telemetry: TeammateAnswerTelemetry;
  attribution: TeammateAnswerAttribution;
  /** Container-owned auxiliary decisions, metered on failure too. */
  additionalUsage?: TeammateEngineResult["usage"];
}

async function answerTeammate(
  options: TeammateAnswerOptions,
  /** The clock this answer opened for itself; null under a turn's own. */
  clock: TurnClock | null
): Promise<TeammateAnswerOutcome> {
  const timings = () => (clock ? { timings: clock.summary() } : {});
  const observer = createTurnObserver(options.forward);
  // Keep completed calls outside the success result: later model requests or
  // persistence may fail after these tokens were already spent.
  const spent: TeammateEngineResult["usage"] = [];
  const usageRows = (messageId: string | null): AiUsageInput[] =>
    projectTeammateUsage({
      usage: [...spent, ...(options.additionalUsage ?? [])],
      organizationId: options.organizationId,
      teammateId: options.teammate.id,
      telemetry: options.telemetry,
      attribution: options.attribution,
      messageId,
    });
  try {
    const result = await runTeammateAnswer({
      db: options.db,
      systemDb: options.systemDb,
      organizationId: options.organizationId,
      teammate: options.teammate,
      connections: options.connections,
      conversationId: options.conversationId,
      personaContext: options.personaContext,
      turn: { ...options.turn, emit: observer.emit, usageSink: spent },
      usage: {
        spenders: {
          teammateId: options.teammate.id,
          memberId: options.attribution.memberId ?? null,
          routineId: options.attribution.routineId ?? null,
        },
        surface: options.attribution.surface,
      },
    });
    options.turn.signal?.throwIfAborted();
    const usage = summarizeTurnUsage([...spent, ...(options.additionalUsage ?? [])]);
    return {
      ok: true,
      result,
      parts: observer.partsWithAudit(result.parts),
      trace: prepareTraceForStorage(observer.trace),
      toolCalls: observer.toolCalls,
      usageRows,
      recordSucceeded: (messageId) =>
        recordRuntimeEvent(options.systemDb ?? options.db, {
          organizationId: options.organizationId,
          assistantId: options.telemetry.assistantId,
          conversationId: options.telemetry.conversationId,
          messageId,
          kind: "chat_turn",
          status: "succeeded",
          outcome: result.outcome ?? "answered",
          surface: options.telemetry.surface,
          flowId: result.flowId,
          flowName: result.flowName,
          durationMs: Date.now() - options.telemetry.startedAt,
          provider: usage.provider,
          modelId: usage.modelId,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          toolCalls: observer.toolCalls,
          ...timings(),
        }),
    };
  } catch (error) {
    return {
      ok: false,
      error,
      toolCalls: observer.toolCalls,
      usageRows,
      recordFailed: () =>
        recordRuntimeEvent(options.systemDb ?? options.db, {
          organizationId: options.organizationId,
          assistantId: options.telemetry.assistantId,
          conversationId: options.telemetry.conversationId,
          kind: "chat_turn",
          status: "failed",
          outcome: "failed",
          surface: options.telemetry.surface,
          durationMs: Date.now() - options.telemetry.startedAt,
          toolCalls: observer.toolCalls,
          ...summarizeTurnUsage([...spent, ...(options.additionalUsage ?? [])]),
          errorClass: errorClassOf(error),
          ...timings(),
        }),
    };
  }
}

/**
 * The Memory Documents one AI Teammate answer reads.
 *
 * Private Conversations pass no shared Project. A Teammate Channel may add its
 * own Project after the Teammate's Project, making the thread's decisions the
 * most specific prompt context without duplicating user or Agent reads.
 */
export async function teammateMemorySections(
  db: Db,
  options: {
    teammate: Teammate;
    memberId: string;
    sharedProjectId?: string | null;
  },
): Promise<string[]> {
  const { teammate, memberId, sharedProjectId } = options;
  const organizationId = teammate.organizationId;
  const [user, agent, ownProject, sharedProject] = await Promise.all([
    db.getMemoryDocument(organizationId, { scope: "user", memberId }),
    db.getMemoryDocument(organizationId, {
      scope: "agent",
      teammateId: teammate.id,
    }),
    teammate.projectId
      ? db.table("projects").get(teammate.projectId)
      : Promise.resolve(null),
    sharedProjectId && sharedProjectId !== teammate.projectId
      ? db.table("projects").get(sharedProjectId)
      : Promise.resolve(null),
  ]);

  const own = projectInjects(ownProject) ? ownProject : null;
  const shared = projectInjects(sharedProject) ? sharedProject : null;
  const projectBody = async (project: { id: string } | null) =>
    project
      ? (
          await db.getMemoryDocument(organizationId, {
            scope: "project",
            projectId: project.id,
          })
        )?.body
      : undefined;
  const [ownBody, sharedBody] = await Promise.all([
    projectBody(own),
    projectBody(shared),
  ]);

  // Dated lines render with their age, so the model weighs a note from March
  // as a note from March (memory-documents.ts).
  const today = new Date().toISOString().slice(0, 10);
  return [
    ...memoryPromptSections({
      user: user?.body,
      agent: agent?.body,
      project: ownBody,
      projectName: own?.name,
      today,
    }),
    ...memoryPromptSections({
      project: sharedBody,
      projectName: shared?.name,
      today,
    }),
  ];
}
