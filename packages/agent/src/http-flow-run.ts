import type { Assistant, Flow, FlowAction } from "@agent-hub/core";
import {
  actionAllowedForTrigger,
  httpFlowMethods,
  httpFlowRequestVariables,
  type HttpFlowRequest,
} from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import { raiseImprovement } from "@agent-hub/db";
import { ACTION_HANDLERS } from "./actions";
import { dbConnectorRuntime } from "./connector-request";
import { sendEmail } from "./email";
import { createTurnSession } from "./session";
import type { ActionContext, ActionEffect, ChatReplyPart, RuntimeEvent } from "./types";

/**
 * Running a Flow that an inbound HTTP request started (#843).
 *
 * Deliberately **not** `streamConversationTurn`. That pipeline exists to answer
 * a person: it persists their words, keeps a transcript, spends an AI budget,
 * recalls memory and streams parts to something that renders them. An inbound
 * request has none of those (no Visitor, no widget, no history), and running
 * it through that path would put a machine-to-machine call into the Inbox and
 * the Insights population, which ADR-0010 is careful to keep for Visitors.
 *
 * What a run leaves behind is one `httpFlowRuns` row: which actions ran, what
 * the caller was told, how long it took and which action threw. Written after
 * the answer is decided and never on the caller's critical path for
 * correctness: a record that failed to write is logged, not turned into a 500.
 *
 * It is also not `runProactiveFlows`: a nudge has nobody waiting on it, and the
 * whole point here is the caller holding a socket for the answer.
 *
 * So it is a third, small dispatcher: no classification (the URL names the
 * Flow), no model, the request's own facts as template variables, and the
 * `respond` action's part lifted off the end as the reply. What it shares with
 * the other two is `ACTION_HANDLERS`, which is the thing that must not fork.
 */

/** What the route sends back. */
export interface HttpFlowResult {
  status: number;
  headers: Record<string, string>;
  body: string;
  /** Actions that ran, in order; also what the run record keeps. */
  ran: FlowAction[];
  /** Set when an action threw; the caller still gets an answer. */
  failed: { action: string; message: string } | null;
}

/**
 * The refusals a route can hit before any action runs. Separated from the
 * result because none of them is the Flow's answer: they are reasons it never
 * ran, and a route must not dress them up as one.
 */
export type HttpFlowRefusal =
  | { reason: "not_found" }
  | { reason: "disabled" }
  | { reason: "wrong_trigger" }
  | { reason: "method_not_allowed"; allowed: string[] };

export function refuseHttpFlow(
  flow: Flow | null,
  method: string
): HttpFlowRefusal | null {
  if (!flow) return { reason: "not_found" };
  if ((flow.trigger ?? "message") !== "http_request") return { reason: "wrong_trigger" };
  // Disabled is deliberately distinct from missing: an Editor who turned a Flow
  // off wants to hear that it is off, not that their URL is wrong.
  if (!flow.enabled) return { reason: "disabled" };
  const allowed = httpFlowMethods(flow);
  if (!allowed.includes(method.toUpperCase() as (typeof allowed)[number])) {
    return { reason: "method_not_allowed", allowed };
  }
  return null;
}

/**
 * Dispatch one inbound Flow and collect its answer.
 *
 * A Flow that never reaches a `respond` answers 204: it did its work and said
 * nothing, which is a real thing for a Flow to do and reads better than a 200
 * with an empty body pretending to be an answer.
 *
 * An action that throws does not take the response with it. The Flow's earlier
 * actions have already happened (a record was created, an email went), and
 * the caller needs to be told the request was received and then went wrong,
 * not left to guess from a socket that closed.
 */
export async function runHttpFlow(options: {
  db: Db;
  assistant: Assistant;
  flow: Flow;
  request: HttpFlowRequest;
  /** The Publication the Flow was read from, for the run record. */
  publicationId?: string | null;
  platformPrompt?: string;
  emit?: (event: RuntimeEvent) => void;
  signal?: AbortSignal;
  now?: () => number;
}): Promise<HttpFlowResult> {
  const { db, assistant, flow, request, platformPrompt = "", signal } = options;
  const emit = options.emit ?? (() => {});
  const now = options.now ?? Date.now;
  const startedAt = now();

  const parts: ChatReplyPart[] = [];
  const ran: FlowAction[] = [];
  const effects: ActionEffect[] = [];
  let failed: HttpFlowResult["failed"] = null;

  const ctx: ActionContext = {
    assistant,
    platformPrompt,
    flow,
    // No Visitor and no history: `workflow.message` is the request body, so a
    // step written against a chat Flow still has something sensible to read.
    message: request.body,
    history: [],
    templateContext: {
      ...httpFlowRequestVariables(request),
      "workflow.message": request.body,
      "workflow.name": flow.name,
    },
    chatModel: null,
    // No Conversation, so no session state to carry: an inbound run is
    // stateless by construction, and the empty session is what says so.
    session: createTurnSession("", {}),
    skills: [],
    priorParts: parts,
    emit,
    signal,
    previewSurface: false,
    // Connector actions (#839) run under the Organization's own Connections,
    // never a Member's: there is no Member here, only a key. Same line the
    // widget draws.
    connectorRuntime: dbConnectorRuntime(db, assistant.organizationId, {
      allowPersonal: false,
      memberId: null,
    }),
  };

  for (const [actionIndex, action] of flow.actions.entries()) {
    if (signal?.aborted) break;
    // The save-time gate is the first of two; this is the second. A Flow whose
    // trigger changed after it was written must not run an action that trigger
    // never allowed.
    if (!actionAllowedForTrigger(action, "http_request")) continue;
    const handler = ACTION_HANDLERS[action];
    if (!handler) continue;
    ctx.actionIndex = actionIndex;
    ran.push(action);
    try {
      const result = await handler(ctx);
      parts.push(...result.parts);
      if (result.effects) effects.push(...result.effects);
      if (result.templatePatch) {
        ctx.templateContext = { ...ctx.templateContext, ...result.templatePatch };
      }
      if (result.halt) break;
    } catch (error) {
      failed = { action, message: error instanceof Error ? error.message : String(error) };
      break;
    }
  }

  // The effect-only handlers (`improvement`, `send_email`) say what should
  // happen and leave the doing to the turn that persisted the message. There
  // is no message here, so they are applied now, each on its own: one failing
  // never takes the answer or the others with it.
  await applyHttpFlowEffects(effects, { db, organizationId: assistant.organizationId, flow });

  const response = [...parts]
    .reverse()
    .find((part): part is Extract<ChatReplyPart, { type: "http_response" }> =>
      part.type === "http_response"
    );
  const result: HttpFlowResult = response
    ? { status: response.status, headers: response.headers, body: response.body, ran, failed }
    : // 500 when an action threw before the Flow could answer: the caller's
      // request was not completed, and a 204 would say it was.
      { status: failed ? 500 : 204, headers: {}, body: "", ran, failed };

  try {
    await db.table("httpFlowRuns").insert({
      organizationId: assistant.organizationId,
      assistantId: assistant.id,
      flowId: flow.id,
      publicationId: options.publicationId ?? null,
      method: request.method.toUpperCase(),
      status: result.status,
      ran,
      failedAction: failed?.action ?? null,
      failedMessage: failed?.message ?? null,
      durationMs: Math.max(0, now() - startedAt),
    });
  } catch (error) {
    // Best effort: a run that could not be recorded is logged, never a 500.
    console.error(`[http-flow] run of flow ${flow.id} was not recorded:`, error);
  }
  return result;
}

/**
 * The deferred effects, applied without a Conversation. An Improvement raised
 * here has no message to link, so it is filed on its own and its title says
 * which Flow raised it; an email goes through the same transport a turn uses.
 */
async function applyHttpFlowEffects(
  effects: ActionEffect[],
  ctx: { db: Db; organizationId: string; flow: Pick<Flow, "id" | "name"> }
): Promise<void> {
  for (const [index, effect] of effects.entries()) {
    try {
      if (effect.kind === "create_improvement") {
        await raiseImprovement(ctx.db, ctx.organizationId, {
          title: effect.title,
          messageId: null,
        });
      } else if (effect.kind === "send_email") {
        const delivery = await sendEmail(effect, {
          idempotencyKey: `http-flow:${ctx.flow.id}:${index}:${Date.now()}`,
        });
        if (!delivery.delivered) throw new Error(`Email ${delivery.reason}`);
      }
    } catch (error) {
      console.error(`[http-flow] ${effect.kind} failed for flow ${ctx.flow.id}:`, error);
    }
  }
}
