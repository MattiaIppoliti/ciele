import type { Assistant, Db } from "@agent-hub/db";

export interface AdminShellReads {
  assistants: Assistant[];
  activeAlertCount: number;
}

export interface AdminPageReads {
  assistants: () => Promise<Assistant[]>;
  activeAlertCount: () => Promise<number>;
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

  const assistants = () =>
    (assistantsPromise ??= db.listAssistants(organizationId));
  const activeAlertCount = () =>
    (activeAlertCountPromise ??= db.countActiveAlerts(organizationId));

  return {
    assistants,
    activeAlertCount,
    async shell() {
      const [assistantRows, alertCount] = await Promise.all([
        assistants(),
        activeAlertCount(),
      ]);
      return {
        assistants: assistantRows,
        activeAlertCount: alertCount,
      };
    },
  };
}
