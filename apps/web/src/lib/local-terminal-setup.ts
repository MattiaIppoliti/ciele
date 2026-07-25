import type { ConnectorProvider } from "./local-connector-protocol";

export interface TerminalAuthCommand {
  provider: ConnectorProvider;
  label: string;
  description: string;
  loginCommand: string;
  statusCommand: string;
}

export const TERMINAL_AUTH_COMMANDS: TerminalAuthCommand[] = [
  {
    provider: "openai",
    label: "ChatGPT Subscription",
    description: "Opens the official Codex browser login for your ChatGPT account.",
    loginCommand: "codex login",
    statusCommand: "codex login status",
  },
  {
    provider: "anthropic",
    label: "Claude Subscription",
    description: "Opens the official Claude login for your claude.ai account.",
    loginCommand: "claude auth login --claudeai",
    statusCommand: "claude auth status --json",
  },
];
