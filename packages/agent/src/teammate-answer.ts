import type {
  AiUsageInput,
  ProviderConnection,
  StoredTurnTrace,
  Teammate,
} from "@agent-hub/core";
import {
  memoryPromptSections,
  projectInjects,
  teammateDefaultFlow,
  teammatePersonaPrompt,
  teammateRuntimeAssistant,
  teammateSearchesKnowledge,
} from "@agent-hub/core";
import type { Db } from "@agent-hub/db";

import { runAssistantChat } from "./engine";
import { buildCollectionSearcher } from "./retrieval";
import { errorClassOf, recordRuntimeEvent } from "./telemetry";
import { prepareTraceForStorage } from "./trace";
import { createTurnObserver } from "./turn-observer";
import type { ChatReplyPart, RuntimeEvent } from "./types";
import { summarizeTurnUsage } from "./usage";

type AssistantChatOptions = Parameters<typeof runAssistantChat>[0];

export type TeammateAnswerTurn = Omit<
  AssistantChatOptions,
  | "assistant"
  | "persona"
  | "flows"
  | "connections"
  | "searchKnowledge"
>;

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
  organizationId: string;
  teammate: Teammate;
  connections: ProviderConnection[];
  /** Conversation attribution for embeddings; null for a Channel. */
  conversationId: string | null;
  /** Container-specific prompt context, after the Standing Role. */
  personaContext?: string;
  turn: TeammateAnswerTurn;
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

  return runAssistantChat({
    ...turn,
    assistant: teammateRuntimeAssistant(teammate),
    persona,
    flows: [teammateDefaultFlow(teammate)],
    connections,
    searchKnowledge: teammateSearchesKnowledge(teammate)
      ? buildCollectionSearcher({
          db,
          connections,
          organizationId,
          collectionIds: teammate.collectionIds,
          sourceIds: teammate.sourceIds,
          conversationId,
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
      recordFailed: () => Promise<void>;
    };

/**
 * The complete model-backed Teammate answer lifecycle shared by Conversation
 * and Channel adapters. Containers still own persistence and continuation;
 * this seam owns execution, public event projection, trace/audit folding,
 * usage projection and the telemetry facts derived from the answer.
 */
export async function executeTeammateAnswer(options: {
  db: Db;
  organizationId: string;
  teammate: Teammate;
  connections: ProviderConnection[];
  conversationId: string | null;
  personaContext?: string;
  turn: TeammateAnswerTurn;
  forward: (event: RuntimeEvent) => void;
  telemetry: TeammateAnswerTelemetry;
}): Promise<TeammateAnswerOutcome> {
  const observer = createTurnObserver(options.forward);
  try {
    const result = await runTeammateAnswer({
      db: options.db,
      organizationId: options.organizationId,
      teammate: options.teammate,
      connections: options.connections,
      conversationId: options.conversationId,
      personaContext: options.personaContext,
      turn: { ...options.turn, emit: observer.emit },
    });
    const usage = summarizeTurnUsage(result.usage);
    const usageRows = (messageId: string | null): AiUsageInput[] =>
      result.usage.map((event) => ({
        organizationId: options.organizationId,
        assistantId: options.telemetry.assistantId,
        conversationId: options.telemetry.conversationId,
        messageId,
        stage: event.stage,
        provider: event.provider,
        modelId: event.modelId,
        credentialKind: event.credentialKind,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
      }));
    return {
      ok: true,
      result,
      parts: observer.partsWithAudit(result.parts),
      trace: prepareTraceForStorage(observer.trace),
      toolCalls: observer.toolCalls,
      usageRows,
      recordSucceeded: (messageId) =>
        recordRuntimeEvent(options.db, {
          organizationId: options.organizationId,
          assistantId: options.telemetry.assistantId,
          conversationId: options.telemetry.conversationId,
          messageId,
          kind: "chat_turn",
          status: "succeeded",
          surface: options.telemetry.surface,
          flowId: result.flowId,
          flowName: result.flowName,
          durationMs: Date.now() - options.telemetry.startedAt,
          provider: usage.provider,
          modelId: usage.modelId,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          toolCalls: observer.toolCalls,
        }),
    };
  } catch (error) {
    return {
      ok: false,
      error,
      toolCalls: observer.toolCalls,
      recordFailed: () =>
        recordRuntimeEvent(options.db, {
          organizationId: options.organizationId,
          assistantId: options.telemetry.assistantId,
          conversationId: options.telemetry.conversationId,
          kind: "chat_turn",
          status: "failed",
          surface: options.telemetry.surface,
          durationMs: Date.now() - options.telemetry.startedAt,
          toolCalls: observer.toolCalls,
          errorClass: errorClassOf(error),
          errorMessage:
            error instanceof Error ? error.message : "Unknown error",
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

  return [
    ...memoryPromptSections({
      user: user?.body,
      agent: agent?.body,
      project: ownBody,
      projectName: own?.name,
    }),
    ...memoryPromptSections({
      project: sharedBody,
      projectName: shared?.name,
    }),
  ];
}
