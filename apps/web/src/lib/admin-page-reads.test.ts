import type { Alert, Assistant } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import { describe, expect, it, vi } from "vitest";

import { createAdminPageReads, SHELL_ALERT_LIMIT } from "@/lib/admin-page-reads";

describe("AdminPageReads", () => {
  it("shares each read between concurrent shell and page consumers", async () => {
    const assistants = [
      { id: "assistant-1", organizationId: "org-1", title: "Admissions" },
    ] as Assistant[];
    const activeAlerts = [
      { id: "alert-1", organizationId: "org-1", status: "active" },
    ] as Alert[];
    const listAssistants = vi.fn(async () => assistants);
    const assistantSummaries = [
      {
        id: "assistant-1",
        title: "Admissions",
        nickname: "Ada",
        brandColor: null,
        avatarUrl: null,
      },
    ];
    const listAssistantShellSummaries = vi.fn(async () => assistantSummaries);
    const countActiveAlerts = vi.fn(async () => 3);
    const listActiveAlerts = vi.fn(async () => activeAlerts);
    const db = {
      listAssistants,
      listAssistantShellSummaries,
      countActiveAlerts,
      listActiveAlerts,
    } as unknown as Db;
    const reads = createAdminPageReads(db, "org-1");

    const [shellAssistants, repeatedShellAssistants, pageAssistants, alertCount, alerts] =
      await Promise.all([
        reads.assistantShellSummaries(),
        reads.assistantShellSummaries(),
        reads.assistants(),
        reads.activeAlertCount(),
        reads.activeAlerts(),
      ]);

    expect(shellAssistants).toBe(assistantSummaries);
    expect(repeatedShellAssistants).toBe(assistantSummaries);
    expect(pageAssistants).toBe(assistants);
    expect(alertCount).toBe(3);
    expect(alerts).toBe(activeAlerts);
    expect(listAssistants).toHaveBeenCalledOnce();
    expect(listAssistants).toHaveBeenCalledWith("org-1");
    expect(listAssistantShellSummaries).toHaveBeenCalledOnce();
    expect(listAssistantShellSummaries).toHaveBeenCalledWith("org-1");
    expect(countActiveAlerts).toHaveBeenCalledOnce();
    expect(countActiveAlerts).toHaveBeenCalledWith("org-1");
    expect(listActiveAlerts).toHaveBeenCalledOnce();
    expect(listActiveAlerts).toHaveBeenCalledWith("org-1", SHELL_ALERT_LIMIT);
  });
});
