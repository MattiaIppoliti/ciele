import { execFile, spawn, type ChildProcess } from "node:child_process";
import {
  accessSync,
  constants as fsConstants,
  readFileSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, extname, join, resolve, sep } from "node:path";

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

/**
 * Direct-CLI connections are a developer-machine capability, and on a developer
 * machine they are **on by default**: whoever authenticated `codex` / `claude`
 * in their terminal expects the local instance to use that sign-in without a
 * second opt-in step. What still bounds them is unchanged and enforced at every
 * call site: a non-production build, a loopback host, a signed-in Member, and an
 * Organization that enabled personal subscriptions. They work with either data
 * layer, the in-memory demo db or a locally-run Supabase-backed instance with
 * real Organization members.
 *
 * `ENABLE_LOCAL_SUBSCRIPTION_TEST=0` (or `false` / `off`) opts a local instance
 * back out, the escape hatch for reproducing hosted behaviour, where a machine
 * CLI identity must never answer.
 */
export function isLocalSubscriptionDirectEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  const flag = process.env.ENABLE_LOCAL_SUBSCRIPTION_TEST?.trim().toLowerCase();
  return !(flag === "0" || flag === "false" || flag === "off");
}

export function isLoopbackHost(host: string | null): boolean {
  if (!host) return false;
  const normalized = host.trim().toLowerCase();
  // A bare IPv6 literal carries no port; anything else splits on the port.
  const hostname =
    normalized === "::1"
      ? normalized
      : normalized.startsWith("[")
        ? normalized.slice(0, normalized.indexOf("]") + 1)
        : normalized.split(":")[0];
  return (
    hostname === "localhost" ||
    // Dev servers and proxies routinely serve a project on its own
    // `*.localhost` label; every one of them resolves to loopback.
    hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

export function isLocalSubscriptionProvider(
  provider: string
): provider is LocalSubscriptionProvider {
  return provider === "openai" || provider === "anthropic";
}

/**
 * Well-known install locations probed when the CLI is not on the server
 * process's PATH. Desktop apps bundle the CLI without linking it anywhere
 * (the ChatGPT app ships `codex` in its Resources; the retired Codex app did
 * the same), and GUI-launched dev servers often miss Homebrew/npm bin dirs.
 */
function fallbackCommandPaths(
  provider: LocalSubscriptionProvider,
  platform: NodeJS.Platform = process.platform
): string[] {
  const home = homedir();
  const windows = [
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Programs") : "",
    process.env.APPDATA ? join(process.env.APPDATA, "npm") : "",
  ].filter(Boolean);
  if (provider === "openai") {
    return [
      ...(platform === "win32"
        ? windows.map((dir) => join(dir, "codex"))
        : [
            "/Applications/ChatGPT.app/Contents/Resources/codex",
            "/Applications/Codex.app/Contents/Resources/codex",
            "/opt/homebrew/bin/codex",
            "/usr/local/bin/codex",
          ]),
      join(home, ".local", "bin", "codex"),
      join(home, ".npm-global", "bin", "codex"),
    ];
  }
  return [
    join(home, ".local", "bin", "claude"),
    join(home, ".claude", "local", "claude"),
    ...(platform === "win32"
      ? windows.map((dir) => join(dir, "claude"))
      : [
          "/opt/homebrew/bin/claude",
          "/usr/local/bin/claude",
          join(home, ".npm-global", "bin", "claude"),
        ]),
  ];
}

function isExecutableFile(
  candidate: string,
  platform: NodeJS.Platform = process.platform
): boolean {
  try {
    // Windows has no executable bit: presence plus a runnable extension is the
    // only signal available (X_OK degrades to F_OK there anyway).
    accessSync(
      candidate,
      platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK
    );
    return statSync(candidate).isFile();
  } catch {
    // Missing, dangling symlink, or not executable.
    return false;
  }
}

/**
 * npm writes an extensionless POSIX shim next to its `.cmd` twin; only the
 * suffixed variants are runnable on Windows.
 */
export function executableVariants(
  path: string,
  platform: NodeJS.Platform = process.platform
): string[] {
  if (platform !== "win32" || extname(path)) return [path];
  return [`${path}.exe`, `${path}.cmd`];
}

/**
 * The JS entrypoint an npm `.cmd` shim launches. Running the shim itself needs
 * a shell (`cmd.exe /c`), which we refuse: the entrypoint runs under this
 * process's own Node binary instead, with no interpolation surface.
 */
export function npmShimEntrypoint(
  shimPath: string,
  // Shims only exist on Windows, so the entrypoint is judged by Windows rules
  // (presence, no exec bit) even when the caller runs elsewhere, otherwise the
  // same fixture resolves on a developer's Windows box and not in Linux CI.
  platform: NodeJS.Platform = process.platform
): string | null {
  try {
    const source = readFileSync(shimPath, "utf8");
    const match = source.match(
      /%dp0%[\\/]+([^"\r\n]+?\.(?:cjs|mjs|js))(?=["\s])/i
    );
    if (!match) return null;
    const relativePath = match[1].replace(/[\\/]+/g, sep);
    if (!relativePath.toLowerCase().startsWith(`node_modules${sep}`)) {
      return null;
    }
    const root = resolve(dirname(shimPath));
    const entrypoint = resolve(root, relativePath);
    if (!entrypoint.toLowerCase().startsWith(`${root.toLowerCase()}${sep}`)) {
      return null;
    }
    return isExecutableFile(entrypoint, platform) ? entrypoint : null;
  } catch {
    return null;
  }
}

/**
 * Narrows a candidate to something spawnable without a shell. `.ps1`/`.bat`
 * need one, so they are rejected rather than executed through a policy bypass.
 */
export function resolveExecutableCandidate(
  path: string,
  platform: NodeJS.Platform = process.platform
): string | null {
  if (!isExecutableFile(path, platform)) return null;
  if (platform !== "win32") return path;
  if (/\.cmd$/i.test(path)) return npmShimEntrypoint(path, platform);
  return /\.(?:bat|ps1)$/i.test(path) ? null : path;
}

function resolveOnPath(
  command: string,
  platform: NodeJS.Platform
): string | null {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    for (const candidate of executableVariants(join(dir, command), platform)) {
      const resolved = resolveExecutableCandidate(candidate, platform);
      if (resolved) return platform === "win32" ? resolved : command;
    }
  }
  return null;
}

export function localSubscriptionCommand(
  provider: LocalSubscriptionProvider,
  platform: NodeJS.Platform = process.platform
): string {
  const config = LOCAL_SUBSCRIPTION_PROVIDERS[provider];
  const override = process.env[config.commandEnv]?.trim();
  if (override) {
    if (platform !== "win32") return override;
    for (const candidate of executableVariants(override, platform)) {
      const resolved = resolveExecutableCandidate(candidate, platform);
      if (resolved) return resolved;
    }
    return override;
  }
  const onPath = resolveOnPath(config.defaultCommand, platform);
  if (onPath) return onPath;
  for (const candidate of fallbackCommandPaths(provider, platform).flatMap(
    (path) => executableVariants(path, platform)
  )) {
    const resolved = resolveExecutableCandidate(candidate, platform);
    if (resolved) return resolved;
  }
  return config.defaultCommand;
}

/**
 * How to spawn a resolved CLI without a shell. POSIX keeps `/usr/bin/env` so a
 * bare command still resolves through the sanitized PATH; Windows has no such
 * launcher, and an npm shim resolves to a JS entrypoint run under this Node.
 */
export function localSubscriptionInvocation(
  command: string,
  args: string[],
  platform: NodeJS.Platform = process.platform
): { command: string; args: string[] } {
  if (platform !== "win32") {
    return { command: EXECUTABLE_LAUNCHER, args: [command, ...args] };
  }
  return /\.(?:cjs|mjs|js)$/i.test(command)
    ? { command: process.execPath, args: [command, ...args] }
    : { command, args };
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
    // Windows equivalents: without these the CLI cannot find its own config
    // directory, its temp dir, or the system DLLs it links against.
    "USERPROFILE",
    "PATHEXT",
    "APPDATA",
    "LOCALAPPDATA",
    "PROGRAMDATA",
    "SystemRoot",
    "SystemDrive",
    "WINDIR",
    "ComSpec",
    "TEMP",
    "TMP",
    "NUMBER_OF_PROCESSORS",
    "PROCESSOR_ARCHITECTURE",
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

const EXECUTABLE_LAUNCHER = "/usr/bin/env";

interface CommandResult {
  stdout: string;
  stderr: string;
  missing: boolean;
  ok: boolean;
}

function runCommand(
  command: string,
  args: string[],
  timeout = 5_000
): Promise<CommandResult> {
  const invocation = localSubscriptionInvocation(command, args);
  return new Promise((resolve) => {
    execFile(
      invocation.command,
      invocation.args,
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

  const invocation = localSubscriptionInvocation(command, args);
  const child = spawn(invocation.command, invocation.args, {
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
