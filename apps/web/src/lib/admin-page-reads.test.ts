import type { Alert, Assistant } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import { describe, expect, it, vi } from "vitest";

import { createAdminPageReads, SHELL_ALERT_LIMIT } from "@/lib/admin-page-reads";

describe("AdminPageReads", () => {
  it("shares the Assistant read between concurrent shell and page consumers", async () => {
    const assistants = [
      { id: "assistant-1", organizationId: "org-1", title: "Admissions" },
    ] as Assistant[];
    const activeAlerts = [
      { id: "alert-1", organizationId: "org-1", status: "active" },
    ] as Alert[];
    const listAssistants = vi.fn(async () => assistants);
    const countActiveAlerts = vi.fn(async () => 3);
    const listActiveAlerts = vi.fn(async () => activeAlerts);
    const db = {
      listAssistants,
      countActiveAlerts,
      listActiveAlerts,
    } as unknown as Db;
    const reads = createAdminPageReads(db, "org-1");

    const [shell, pageAssistants] = await Promise.all([
      reads.shell(),
      reads.assistants(),
      reads.activeAlerts(),
    ]);

    expect(shell).toEqual({ assistants, activeAlertCount: 3, activeAlerts });
    expect(pageAssistants).toBe(assistants);
    expect(listAssistants).toHaveBeenCalledOnce();
    expect(listAssistants).toHaveBeenCalledWith("org-1");
    expect(countActiveAlerts).toHaveBeenCalledOnce();
    expect(countActiveAlerts).toHaveBeenCalledWith("org-1");
    expect(listActiveAlerts).toHaveBeenCalledOnce();
    expect(listActiveAlerts).toHaveBeenCalledWith("org-1", SHELL_ALERT_LIMIT);
  });
});
