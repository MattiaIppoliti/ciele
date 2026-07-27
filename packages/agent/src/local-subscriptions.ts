import { execFile, spawn, type ChildProcess } from "node:child_process";

export type LocalSubscriptionProvider = "openai" | "anthropic";

export interface LocalSubscriptionStatus {
  provider: LocalSubscriptionProvider;
  label: string;
  detail: string;
  available: boolean;
  connected: boolean;
  connecting: boolean;
  accountLabel?: string;
  plan?: string;
  authMethod?: string;
  error?: string;
}

export const LOCAL_SUBSCRIPTION_PROVIDERS: Record<
  LocalSubscriptionProvider,
  {
    label: string;
    detail: string;
    commandEnv: string;
    defaultCommand: string;
    statusArgs: string[];
    loginArgs: string[];
    logoutArgs: string[];
  }
> = {
  openai: {
    label: "ChatGPT Subscription",
    detail: "ChatGPT account via Codex CLI",
    commandEnv: "CODEX_CLI_PATH",
    defaultCommand: "codex",
    statusArgs: ["login", "status"],
    loginArgs: ["login"],
    logoutArgs: ["logout"],
  },
  anthropic: {
    label: "Claude Subscription",
    detail: "Claude account via Claude Code",
    commandEnv: "CLAUDE_CLI_PATH",
    defaultCommand: "claude",
    statusArgs: ["auth", "status", "--json"],
    loginArgs: ["auth", "login", "--claudeai"],
    logoutArgs: ["auth", "logout"],
  },
};

interface LoginProcess {
  child: ChildProcess;
}

interface LocalSubscriptionProcessState {
  active: Map<LocalSubscriptionProvider, LoginProcess>;
  lastError: Map<LocalSubscriptionProvider, string>;
}

const globalProcesses = globalThis as typeof globalThis & {
  __cieleLocalSubscriptionProcesses?: LocalSubscriptionProcessState;
};

const processState =
  globalProcesses.__cieleLocalSubscriptionProcesses ??
  (globalProcesses.__cieleLocalSubscriptionProcesses = {
    active: new Map(),
    lastError: new Map(),
  });

export function isLocalSubscriptionTestEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  if (
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return false;
  }
  const flag = process.env.ENABLE_LOCAL_SUBSCRIPTION_TEST?.toLowerCase();
  return flag === "1" || flag === "true" || flag === "on";
}

export function isLoopbackHost(host: string | null): boolean {
  if (!host) return false;
  const normalized = host.trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized.startsWith("localhost:") ||
    normalized === "127.0.0.1" ||
    normalized.startsWith("127.0.0.1:") ||
    normalized === "::1" ||
    normalized === "[::1]" ||
    normalized.startsWith("[::1]:")
  );
}

export function isLocalSubscriptionProvider(
  provider: string
): provider is LocalSubscriptionProvider {
  return provider === "openai" || provider === "anthropic";
}

export function localSubscriptionCommand(
  provider: LocalSubscriptionProvider
): string {
  const config = LOCAL_SUBSCRIPTION_PROVIDERS[provider];
  return process.env[config.commandEnv]?.trim() || config.defaultCommand;
}

export function localSubscriptionCliEnvironment(): NodeJS.ProcessEnv {
  const allowed = [
    "HOME",
    "PATH",
    "SHELL",
    "USER",
    "LOGNAME",
    "TMPDIR",
    "TERM",
    "LANG",
    "LC_ALL",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_CACHE_HOME",
    "BROWSER",
    "DISPLAY",
    "WAYLAND_DISPLAY",
    "SSH_AUTH_SOCK",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "no_proxy",
    "SSL_CERT_FILE",
    "CODEX_CA_CERTIFICATE",
    "CODEX_HOME",
    "CLAUDE_CONFIG_DIR",
  ];
  const environment: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV };
  for (const name of allowed) {
    const value = process.env[name];
    if (value !== undefined) environment[name] = value;
  }
  return environment;
}

interface CommandResult {
  stdout: string;
  stderr: string;
  missing: boolean;
  ok: boolean;
}

const EXECUTABLE_LAUNCHER = "/usr/bin/env";

function runCommand(
  command: string,
  args: string[],
  timeout = 5_000
): Promise<CommandResult> {
  return new Promise((resolve) => {
    execFile(
      EXECUTABLE_LAUNCHER,
      [command, ...args],
      {
        encoding: "utf8",
        env: localSubscriptionCliEnvironment(),
        maxBuffer: 64 * 1024,
        timeout,
      },
      (error, stdout, stderr) => {
        resolve({
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          missing:
            error !== null &&
            typeof error === "object" &&
            "code" in error &&
            (error.code === "ENOENT" ||
              (error.code === 127 && /not found|no such file/i.test(stderr ?? ""))),
          ok: !error,
        });
      }
    );
  });
}

export function parseCodexLoginStatus(output: string): {
  connected: boolean;
  authMethod?: string;
  error?: string;
} {
  if (/logged in using chatgpt/i.test(output)) {
    return { connected: true, authMethod: "ChatGPT" };
  }
  if (/logged in using (?:an )?api key/i.test(output)) {
    return {
      connected: false,
      authMethod: "API key",
      error: "Codex is signed in with an API key, not a ChatGPT subscription.",
    };
  }
  return { connected: false };
}

export function parseClaudeLoginStatus(output: string): {
  connected: boolean;
  accountLabel?: string;
  plan?: string;
  authMethod?: string;
  error?: string;
} {
  try {
    const parsed = JSON.parse(output) as {
      loggedIn?: boolean;
      authMethod?: string;
      email?: string;
      subscriptionType?: string;
    };
    if (!parsed.loggedIn) return { connected: false };
    if (parsed.authMethod !== "claude.ai") {
      return {
        connected: false,
        authMethod: parsed.authMethod,
        error: "Claude is not signed in through a Claude subscription.",
      };
    }
    return {
      connected: true,
      authMethod: parsed.authMethod,
      accountLabel: parsed.email,
      plan: parsed.subscriptionType,
    };
  } catch {
    return {
      connected: false,
      error: "Claude CLI returned an unreadable authentication status.",
    };
  }
}

export async function getLocalSubscriptionStatus(
  provider: LocalSubscriptionProvider
): Promise<LocalSubscriptionStatus> {
  const base = {
    provider,
    label: LOCAL_SUBSCRIPTION_PROVIDERS[provider].label,
    detail: LOCAL_SUBSCRIPTION_PROVIDERS[provider].detail,
    connecting: processState.active.has(provider),
  };
  const command = localSubscriptionCommand(provider);
  const result = await runCommand(
    command,
    LOCAL_SUBSCRIPTION_PROVIDERS[provider].statusArgs
  );

  if (result.missing) {
    return {
      ...base,
      available: false,
      connected: false,
      error: `${command} is not installed or is not executable.`,
    };
  }

  const parsed =
    provider === "openai"
      ? parseCodexLoginStatus(`${result.stdout}\n${result.stderr}`)
      : parseClaudeLoginStatus(result.stdout);
  const processError = processState.lastError.get(provider);
  return {
    ...base,
    ...parsed,
    available: true,
    error: parsed.error ?? processError,
  };
}

export async function listLocalSubscriptionStatuses(): Promise<
  LocalSubscriptionStatus[]
> {
  return Promise.all(
    (["openai", "anthropic"] as LocalSubscriptionProvider[]).map((provider) =>
      getLocalSubscriptionStatus(provider)
    )
  );
}

export function connectedLocalSubscriptionProviders(
  statuses: LocalSubscriptionStatus[]
): LocalSubscriptionProvider[] {
  return statuses.filter((status) => status.connected).map((status) => status.provider);
}

export async function startLocalSubscriptionLogin(
  provider: LocalSubscriptionProvider
): Promise<LocalSubscriptionStatus> {
  const current = await getLocalSubscriptionStatus(provider);
  if (current.connected || processState.active.has(provider)) return current;
  if (!current.available) return current;

  const command = localSubscriptionCommand(provider);
  const args = LOCAL_SUBSCRIPTION_PROVIDERS[provider].loginArgs;
  processState.lastError.delete(provider);

  const child = spawn(EXECUTABLE_LAUNCHER, [command, ...args], {
    env: localSubscriptionCliEnvironment(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const loginProcess: LoginProcess = { child };
  processState.active.set(provider, loginProcess);

  child.stdout?.resume();
  child.stderr?.resume();
  child.once("error", (error) => {
    processState.lastError.set(provider, error.message);
    processState.active.delete(provider);
  });
  child.once("exit", (code) => {
    if (code !== 0) {
      processState.lastError.set(
        provider,
        `Login process exited with code ${code}. Run the provider CLI directly for diagnostics.`
      );
    }
    processState.active.delete(provider);
  });

  return { ...current, connecting: true, error: undefined };
}

export function cancelLocalSubscriptionLogin(
  provider: LocalSubscriptionProvider
): void {
  processState.active.get(provider)?.child.kill();
  processState.active.delete(provider);
  processState.lastError.delete(provider);
}

export async function disconnectLocalSubscription(
  provider: LocalSubscriptionProvider
): Promise<LocalSubscriptionStatus> {
  cancelLocalSubscriptionLogin(provider);

  const command = localSubscriptionCommand(provider);
  const result = await runCommand(
    command,
    LOCAL_SUBSCRIPTION_PROVIDERS[provider].logoutArgs,
    10_000
  );
  if (result.missing) {
    throw new Error(`${command} is not installed or is not executable.`);
  }
  if (!result.ok) {
    throw new Error(
      "The provider CLI could not sign out. Run its logout command directly for diagnostics."
    );
  }
  return getLocalSubscriptionStatus(provider);
}
