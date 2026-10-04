import { createHash } from "node:crypto";
import { mergeFlowSecrets, redactFlowSecrets, shortId } from "@agent-hub/core";
import type { Assistant, Flow, FlowContinuation, SkillSnapshot } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";

export interface GateCheckpointInput {
  flow: Flow;
  variables: Record<string, string>;
  message: string;
}
export type GateCheckpointFactory = (kind: "review" | "webhook", input: GateCheckpointInput) => FlowContinuation;

/** Admission captures stop generations before any action runs. Credentials,
 * attachments and identity proof never enter the durable checkpoint. */
export async function admitFlowContinuations(input: {
  db: Db;
  assistant: Assistant;
  skills: SkillSnapshot[];
  publicationId?: string;
  originRequestId: string;
  conversationId: string;
}): Promise<GateCheckpointFactory> {
  const [live, flows] = await Promise.all([
    input.db.getAssistant(input.assistant.id),
    input.db.listFlows(input.assistant.id),
  ]);
  const assistant = structuredClone(input.assistant);
  const skills = structuredClone(input.skills);
  const epochs = new Map(flows.map(flow => [flow.id, flow.continuationEpoch ?? 0]));
  return (kind, checkpoint) => {
    const gateId = shortId();
    const now = new Date().toISOString();
    return {
      id: `${kind}:${gateId}`,
      gateId,
      gateKind: kind,
      organizationId: assistant.organizationId,
      assistantId: assistant.id,
      conversationId: input.conversationId,
      flowId: checkpoint.flow.id,
      originRequestId: input.originRequestId,
      snapshot: {
        assistant,
        skills,
        flow: structuredClone(redactFlowSecrets(checkpoint.flow)),
        opaqueRequestDigest: opaqueRequestDigest(checkpoint.flow, checkpoint.flow, gateId),
        variables: { ...checkpoint.variables },
        message: checkpoint.message,
        publicationId: input.publicationId ?? null,
        assistantEpoch: live?.continuationEpoch ?? 0,
        flowEpoch: epochs.get(checkpoint.flow.id) ?? -1,
      },
      stoppedAt: null,
      stopReason: null,
      createdAt: now,
      updatedAt: now,
    };
  };
}

/** Free-form pairs can contain credentials under ANY name. Keep no raw values
 * and never silently replace admitted business arguments with edited values.
 * Only admitted names participate; newly added pairs do not enter this turn.
 */
export function opaqueRequestDigest(admitted: Flow, current: Flow, salt: string): string {
  const pairs = (before: import("@agent-hub/core").KeyValuePair[] | undefined, now: import("@agent-hub/core").KeyValuePair[] | undefined) => now?.filter(pair => before?.some(slot => slot.name === pair.name)).map(pair => [pair.name, pair.value]) ?? [];
  const old = admitted.actionSettings;
  const live = current.actionSettings;
  return createHash("sha256").update(salt).update(JSON.stringify([
    pairs(old?.api_request?.headers, live?.api_request?.headers),
    pairs(old?.api_request?.queryParams, live?.api_request?.queryParams),
    pairs(old?.http_webhook?.subscribe?.headers, live?.http_webhook?.subscribe?.headers),
    pairs(old?.http_webhook?.unsubscribe?.headers, live?.http_webhook?.unsubscribe?.headers),
  ])).digest("hex");
}

/** Called only after the opaque-slot fingerprint matched. Duplicate pairs and
 * their order survive; the editor's merge helper matches only the first name.
 */
export function restoreContinuationCredentials(admitted: Flow, current: Flow): Flow {
  const settings = mergeFlowSecrets(structuredClone(admitted.actionSettings), current.actionSettings) ?? {};
  const pairs = (before: import("@agent-hub/core").KeyValuePair[] | undefined, now: import("@agent-hub/core").KeyValuePair[] | undefined) => now?.filter(pair => before?.some(slot => slot.name === pair.name)).map(pair => ({ ...pair })) ?? [];
  if (settings.api_request && admitted.actionSettings.api_request) {
    settings.api_request = { ...settings.api_request, headers: pairs(admitted.actionSettings.api_request.headers, current.actionSettings.api_request?.headers), queryParams: pairs(admitted.actionSettings.api_request.queryParams, current.actionSettings.api_request?.queryParams) };
  }
  if (settings.http_webhook) {
    settings.http_webhook = { ...settings.http_webhook };
    for (const kind of ["subscribe", "unsubscribe"] as const) {
      const call = settings.http_webhook[kind];
      if (call) settings.http_webhook[kind] = { ...call, headers: pairs(admitted.actionSettings.http_webhook?.[kind]?.headers, current.actionSettings.http_webhook?.[kind]?.headers) };
    }
  }
  return { ...admitted, actionSettings: settings };
}
