import type { Assistant, Db } from "@agent-hub/db";
import { describe, expect, it, vi } from "vitest";

import { createAdminPageReads } from "@/lib/admin-page-reads";

describe("AdminPageReads", () => {
  it("shares the Assistant read between concurrent shell and page consumers", async () => {
    const assistants = [
      { id: "assistant-1", organizationId: "org-1", title: "Admissions" },
    ] as Assistant[];
    const listAssistants = vi.fn(async () => assistants);
    const countActiveAlerts = vi.fn(async () => 3);
    const db = { listAssistants, countActiveAlerts } as unknown as Db;
    const reads = createAdminPageReads(db, "org-1");

    const [shell, pageAssistants] = await Promise.all([
      reads.shell(),
      reads.assistants(),
    ]);

    expect(shell).toEqual({ assistants, activeAlertCount: 3 });
    expect(pageAssistants).toBe(assistants);
    expect(listAssistants).toHaveBeenCalledOnce();
    expect(listAssistants).toHaveBeenCalledWith("org-1");
    expect(countActiveAlerts).toHaveBeenCalledOnce();
    expect(countActiveAlerts).toHaveBeenCalledWith("org-1");
  });
});
