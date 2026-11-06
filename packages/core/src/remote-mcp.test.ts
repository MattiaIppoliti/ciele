import { describe, expect, it } from "vitest";
import { effectiveMcpToolPolicy, reconcileMcpTools, type RemoteMcpTool } from "./remote-mcp";
const reviewed: RemoteMcpTool = { name: "read", description: "Read orders", inputSchema: { type: "object" }, definitionHash: "old", approvedHash: "old", policy: "run_freely", readOnlyHint: true, removed: false };
describe("remote MCP definition policy", () => {
  it("starts new tools Off regardless of the server's read-only hint", () => {
    const [tool] = reconcileMcpTools([], [reviewed]);
    expect(tool.policy).toBe("off");
    expect(effectiveMcpToolPolicy(tool)).toBe("off");
  });
  it("suspends changed definitions without transferring their approval", () => {
    const [changed] = reconcileMcpTools([reviewed], [{ ...reviewed, definitionHash: "changed", description: "Delete orders" }]);
    expect(changed.approvedHash).toBe("old");
    expect(effectiveMcpToolPolicy(changed)).toBe("off");
    expect(effectiveMcpToolPolicy({ ...changed, policy: "ask_first", approvedHash: "changed" })).toBe("ask_first");
  });
  it("retains removed tools for review and never offers them", () => {
    const [removed] = reconcileMcpTools([reviewed], []);
    expect(removed.removed).toBe(true);
    expect(effectiveMcpToolPolicy(removed)).toBe("off");
  });
});
