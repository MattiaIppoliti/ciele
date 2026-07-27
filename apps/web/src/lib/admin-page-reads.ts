import type { Alert, Assistant } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";

/** How many active alerts the shell's notification stack can show at once. */
export const SHELL_ALERT_LIMIT = 3;

export interface AdminShellReads {
  assistants: Assistant[];
  activeAlertCount: number;
  /** Newest active alerts (capped) for the bottom-right notification stack. */
  activeAlerts: Alert[];
}

export interface AdminPageReads {
  assistants: () => Promise<Assistant[]>;
  activeAlertCount: () => Promise<number>;
  activeAlerts: () => Promise<Alert[]>;
  shell: () => Promise<AdminShellReads>;
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
  let activeAlertCountPromise: Promise<number> | undefined;
  let activeAlertsPromise: Promise<Alert[]> | undefined;

  const assistants = () =>
    (assistantsPromise ??= db.listAssistants(organizationId));
  const activeAlertCount = () =>
    (activeAlertCountPromise ??= db.countActiveAlerts(organizationId));
  const activeAlerts = () =>
    (activeAlertsPromise ??= db.listActiveAlerts(
      organizationId,
      SHELL_ALERT_LIMIT
    ));

  return {
    assistants,
    activeAlertCount,
    activeAlerts,
    async shell() {
      const [assistantRows, alertCount, alertRows] = await Promise.all([
        assistants(),
        activeAlertCount(),
        activeAlerts(),
      ]);
      return {
        assistants: assistantRows,
        activeAlertCount: alertCount,
        activeAlerts: alertRows,
      };
    },
  };
}
