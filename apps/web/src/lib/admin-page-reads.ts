import type {
  Alert,
  Assistant,
  AssistantShellSummary,
} from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import { INGESTION_KINDS } from "@/lib/ingestion-activity-read";

/** How many active alerts the shell's notification stack can show at once. */
export const SHELL_ALERT_LIMIT = 3;

export interface AdminPageReads {
  assistants: () => Promise<Assistant[]>;
  assistantShellSummaries: () => Promise<AssistantShellSummary[]>;
  activeAlertCount: () => Promise<number>;
  /** Newest active alerts (capped) for the bottom-right notification stack. */
  activeAlerts: () => Promise<Alert[]>;
  /** Is any Source still being crawled or ingested right now? */
  ingestionInFlight: () => Promise<boolean>;
}

/**
 * Request-local read coordinator shared by the admin layout and page tree.
 * Promise memoization collapses concurrent consumers without persisting any
 * RLS-bound data beyond the current render request.
 */
export function createAdminPageReads(
  db: Db,
  organizationId: string,
): AdminPageReads {
  let assistantsPromise: Promise<Assistant[]> | undefined;
  let assistantShellSummariesPromise:
    | Promise<AssistantShellSummary[]>
    | undefined;
  let activeAlertCountPromise: Promise<number> | undefined;
  let activeAlertsPromise: Promise<Alert[]> | undefined;
  let ingestionInFlightPromise: Promise<boolean> | undefined;

  const assistants = () =>
    (assistantsPromise ??= db.listAssistants(organizationId));
  const assistantShellSummaries = () =>
    (assistantShellSummariesPromise ??=
      db.listAssistantShellSummaries(organizationId));
  const activeAlertCount = () =>
    (activeAlertCountPromise ??= db.countActiveAlerts(organizationId));
  const activeAlerts = () =>
    (activeAlertsPromise ??= db.listActiveAlerts(
      organizationId,
      SHELL_ALERT_LIMIT
    ));

  // A tally, not a page: `pageSize: 0` asks the hub read for counts alone and
  // hydrates no rows. The shell only needs to know whether the activity card
  // should start polling; what is running is the card's own first poll.
  const ingestionInFlight = () =>
    (ingestionInFlightPromise ??= db
      .listOrgKnowledgeSources(organizationId, {
        kinds: INGESTION_KINDS,
        status: "processing",
        pageSize: 0,
      })
      .then((page) => page.total > 0)
      .catch(() => false));

  return {
    assistants,
    assistantShellSummaries,
    activeAlertCount,
    activeAlerts,
    ingestionInFlight,
  };
}
