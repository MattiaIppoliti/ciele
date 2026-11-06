import { describe, expect, it } from "vitest";
import { auditActionInfo } from "./audit-log";

describe("audit action labels", () => {
  it("names the governance operations an administrator scans for", () => {
    expect(auditActionInfo("members.updateRole")).toEqual({ label: "Changed member role", tone: "changed" });
    expect(auditActionInfo("apiKeys.revoke")).toEqual({ label: "Revoked API key", tone: "removed" });
  });

  it("reads any other operation from its name", () => {
    expect(auditActionInfo("flows.update")).toEqual({ label: "Updated flow", tone: "changed" });
    expect(auditActionInfo("knowledge.sources.delete")).toEqual({ label: "Deleted knowledge source", tone: "removed" });
    expect(auditActionInfo("helpDesks.create")).toEqual({ label: "Created help desk", tone: "added" });
    expect(auditActionInfo("businessHours.delete").label).toBe("Deleted business hour");
    expect(auditActionInfo("mcpServers.delete").label).toBe("Deleted MCP server");
    expect(auditActionInfo("helpDesks.channels.delete").label).toBe("Deleted help desk channel");
    expect(auditActionInfo("knowledge.sources.unlink")).toEqual({ label: "Unlinked knowledge source", tone: "removed" });
  });

  it("shows a name it cannot read as it is", () => {
    expect(auditActionInfo("inbox.conversations.legalHold")).toEqual({
      label: "inbox.conversations.legalHold",
      tone: "changed",
    });
  });
});
