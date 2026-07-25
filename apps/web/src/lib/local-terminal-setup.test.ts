import { describe, expect, it } from "vitest";
import { TERMINAL_AUTH_COMMANDS } from "./local-terminal-setup";

describe("TERMINAL_AUTH_COMMANDS", () => {
  it("uses the same official login and status commands as the connector", () => {
    expect(TERMINAL_AUTH_COMMANDS).toEqual([
      expect.objectContaining({
        provider: "openai",
        loginCommand: "codex login",
        statusCommand: "codex login status",
      }),
      expect.objectContaining({
        provider: "anthropic",
        loginCommand: "claude auth login --claudeai",
        statusCommand: "claude auth status --json",
      }),
    ]);
  });

  it("never embeds Ciele secrets or pipes downloaded code into a shell", () => {
    for (const item of TERMINAL_AUTH_COMMANDS) {
      const commands = `${item.loginCommand}\n${item.statusCommand}`;
      expect(commands).not.toMatch(/token|secret|authorization|bearer/i);
      expect(commands).not.toMatch(/curl|wget|\|\s*(?:sh|zsh|bash)/i);
    }
  });
});
