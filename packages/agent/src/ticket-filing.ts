import type { FiledTicket, TicketDraft, TicketingTarget } from "@agent-hub/core";
import { filedTicketFromOutputs, ticketConnectorSettings } from "@agent-hub/core";
import {
  executeConnectorAction,
  type ConnectorDeps,
  type ConnectorError,
  type ConnectorRuntime,
} from "./connector-request";

export type TicketFilingOutcome =
  | { ok: true; ticket: FiledTicket }
  | { ok: false; error: ConnectorError };

/**
 * Files a "Create a ticket" channel submission (#1088, #1089) through the
 * catalogued Create case / Create record action, the same request a Flow's
 * Connector step makes: one egress guard, one token refresh, one error shape.
 * The params run literally, a Visitor's `{{…}}` is their text, and the
 * runtime is never `allowPersonal`, so a Member-owned Connection is refused
 * before any call.
 */
export async function fileTicket(
  target: TicketingTarget,
  draft: TicketDraft,
  runtime: ConnectorRuntime,
  deps: ConnectorDeps = {}
): Promise<TicketFilingOutcome> {
  const outcome = await executeConnectorAction(
    ticketConnectorSettings(target, draft),
    null,
    { ...runtime, allowPersonal: false },
    deps
  );
  if (!outcome.ok) {
    return {
      ok: false,
      error: outcome.error ?? {
        provider: target.provider,
        code: "provider",
        message: "The ticket could not be filed",
        status: outcome.status,
      },
    };
  }
  return { ok: true, ticket: filedTicketFromOutputs(target.provider, outcome.outputs) };
}
