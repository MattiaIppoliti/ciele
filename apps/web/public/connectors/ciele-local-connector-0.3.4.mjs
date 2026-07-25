#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import {
  accessSync,
  constants,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile, spawn } from "node:child_process";

const VERSION = "0.3.4";
const APP_DIR =
  process.env.CIELE_CONNECTOR_HOME?.trim() ||
  dirname(fileURLToPath(import.meta.url));
const PAIRING_FILE = join(APP_DIR, "pairing.json");
const RELAY_FILE = join(APP_DIR, "relay.json");
const PID_FILE = join(APP_DIR, "connector.pid");
const MODEL_SELECTOR =
  /^(automatic|local:(openai|anthropic):[a-z0-9][a-z0-9._-]{0,99})$/;
const DEFAULT_PREFERENCES = {
  defaultModel: "automatic",
  followUpBehavior: "queue",
};

const PROVIDERS = {
  openai: {
    label: "ChatGPT Account",
    executable: "codex",
    environment: "CODEX_CLI_PATH",
    candidates: [
      "/Applications/ChatGPT.app/Contents/Resources/codex",
      join(homedir(), ".local/bin/codex"),
      join(homedir(), ".local/bin/codex.exe"),
      ...(process.env.APPDATA
        ? [join(process.env.APPDATA, "npm/codex.cmd")]
        : []),
      "/opt/homebrew/bin/codex",
      "/usr/local/bin/codex",
    ],
    statusArgs: ["login", "status"],
    loginArgs: ["login"],
    logoutArgs: ["logout"],
  },
  anthropic: {
    label: "Claude Subscription",
    executable: "claude",
    environment: "CLAUDE_CLI_PATH",
    candidates: [
      join(homedir(), ".local/bin/claude"),
      join(homedir(), ".local/bin/claude.exe"),
      join(homedir(), ".claude/local/claude"),
      join(homedir(), ".claude/local/claude.exe"),
      ...(process.env.APPDATA
        ? [join(process.env.APPDATA, "npm/claude.cmd")]
        : []),
      "/opt/homebrew/bin/claude",
      "/usr/local/bin/claude",
    ],
    statusArgs: ["auth", "status", "--json"],
    loginArgs: ["auth", "login", "--claudeai"],
    logoutArgs: ["auth", "logout"],
  },
};

const activeLogins = new Map();
const lastErrors = new Map();
const inferenceChecks = new Map();
let codexSnapshotCache = null;

const CLAUDE_MODELS = [
  { id: "fable", label: "Claude Fable", inputModalities: ["text", "image"] },
  { id: "sonnet", label: "Claude Sonnet", inputModalities: ["text", "image"] },
  { id: "opus", label: "Claude Opus", inputModalities: ["text", "image"] },
];

function parseArguments(argv) {
  const values = new Map();
  const flags = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === "--no-open" || name === "--bootstrap") {
      flags.add(name);
      continue;
    }
    if (!name.startsWith("--") || index + 1 >= argv.length) {
      throw new Error(`Invalid connector argument: ${name}`);
    }
    values.set(name, argv[index + 1]);
    index += 1;
  }
  return { values, flags };
}

function normalizeOrigin(value) {
  const url = new URL(value);
  const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
  if (
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && loopbackHosts.has(url.hostname))) ||
    url.username ||
    url.password
  ) {
    throw new Error("Unsupported Ciele origin.");
  }
  return url.origin;
}

function isExecutable(path) {
  try {
    accessSync(path, process.platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function executableVariants(path) {
  if (process.platform !== "win32" || extname(path)) return [path];
  // npm writes an extensionless POSIX shim next to its .cmd twin. Windows
  // cannot execute the bare file, so only the runnable variants qualify.
  return [`${path}.exe`, `${path}.cmd`];
}

export function npmShimEntrypoint(shimPath) {
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
    return isExecutable(entrypoint) ? entrypoint : null;
  } catch {
    return null;
  }
}

export function resolveExecutableCandidate(path) {
  if (!isExecutable(path)) return null;
  if (process.platform !== "win32") return path;
  if (/\.cmd$/i.test(path)) return npmShimEntrypoint(path);
  return /\.(?:bat|ps1)$/i.test(path) ? null : path;
}

function findExecutable(provider) {
  const config = PROVIDERS[provider];
  const candidates = [];
  const home = homedir();
  const override = process.env[config.environment]?.trim();
  if (override) candidates.push(override);
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (directory) candidates.push(join(directory, config.executable));
  }
  candidates.push(
    join(home, ".volta/bin", config.executable),
    join(home, ".asdf/shims", config.executable),
    join(home, ".bun/bin", config.executable),
    join(home, ".npm-global/bin", config.executable),
    join(home, ".local/share/pnpm", config.executable)
  );
  for (const [root, suffix] of [
    [join(home, ".nvm/versions/node"), "bin"],
    [join(home, ".local/share/fnm/node-versions"), "installation/bin"],
  ]) {
    try {
      for (const version of readdirSync(root)) {
        candidates.push(join(root, version, suffix, config.executable));
      }
    } catch {
      // The version manager is not installed.
    }
  }
  candidates.push(...config.candidates);
  for (const candidate of candidates.flatMap(executableVariants)) {
    const resolved = resolveExecutableCandidate(candidate);
    if (resolved) return resolved;
  }
  return null;
}

function cliEnvironment() {
  const allowed = [
    "HOME",
    "USERPROFILE",
    "PATH",
    "PATHEXT",
    "APPDATA",
    "LOCALAPPDATA",
    "PROGRAMDATA",
    "SystemRoot",
    "WINDIR",
    "ComSpec",
    "SHELL",
    "USER",
    "LOGNAME",
    "TMPDIR",
    "TEMP",
    "TMP",
    "TERM",
    "LANG",
    "LC_ALL",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_CACHE_HOME",
    "BROWSER",
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
  const environment = {};
  for (const name of allowed) {
    if (process.env[name] !== undefined) environment[name] = process.env[name];
  }
  return environment;
}

export function commandInvocation(command, args) {
  if (process.platform === "win32" && /\.(?:cjs|mjs|js)$/i.test(command)) {
    return {
      command: process.execPath,
      args: [command, ...args],
    };
  }
  return { command, args };
}

function openExternalUrl(url) {
  const invocation =
    process.platform === "win32"
      ? { command: "explorer.exe", args: [url] }
      : process.platform === "darwin"
        ? { command: "/usr/bin/open", args: [url] }
        : { command: "xdg-open", args: [url] };
  const browser = spawn(invocation.command, invocation.args, {
    detached: true,
    stdio: "ignore",
  });
  browser.unref();
}

function runCommand(command, args, timeout = 8_000, maxBuffer = 64 * 1024) {
  return new Promise((resolve) => {
    const invocation = commandInvocation(command, args);
    execFile(
      invocation.command,
      invocation.args,
      {
        encoding: "utf8",
        env: cliEnvironment(),
        maxBuffer,
        timeout,
      },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          stdout: stdout ?? "",
          stderr: stderr ?? "",
        });
      }
    );
  });
}

function runCommandWithInput(command, args, input, timeout = 180_000) {
  return new Promise((resolve) => {
    const invocation = commandInvocation(command, args);
    const child = spawn(invocation.command, invocation.args, {
      env: cliEnvironment(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const append = (current, chunk) => {
      const next = current + chunk.toString("utf8");
      if (next.length > 4 * 1024 * 1024) {
        child.kill();
        finish({ ok: false, stdout, stderr: "Provider response exceeded 4 MB." });
        return current;
      }
      return next;
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ ok: false, stdout, stderr: "Provider inference timed out." });
    }, timeout);
    child.stdout.on("data", chunk => { stdout = append(stdout, chunk); });
    child.stderr.on("data", chunk => { stderr = append(stderr, chunk); });
    child.once("error", error => finish({ ok: false, stdout, stderr: error.message }));
    child.once("close", code => finish({ ok: code === 0, stdout, stderr }));
    child.stdin.end(input);
  });
}

function readRelay() {
  try {
    const value = JSON.parse(readFileSync(RELAY_FILE, "utf8"));
    if (
      typeof value.token === "string" &&
      /^[A-Za-z0-9_-]{32,256}$/.test(value.token)
    ) {
      return value;
    }
  } catch {
    // Relay pairing is completed after the browser discovers the connector.
  }
  return null;
}

function saveRelay(value) {
  writeFileSync(RELAY_FILE, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return value;
}

function scopedStateFile(name, scope) {
  if (!/^[a-f0-9]{64}$/.test(scope)) {
    throw new Error("Invalid connector scope.");
  }
  return join(APP_DIR, `${name}.${scope}.json`);
}

function readTokenUsage(scope) {
  try {
    const value = JSON.parse(readFileSync(scopedStateFile("usage", scope), "utf8"));
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function recordTokenUsage(scope, provider, result) {
  const count = value =>
    Number.isSafeInteger(value) && value >= 0 ? value : 0;
  const inputTokens = count(result?.inputTokens);
  const outputTokens = count(result?.outputTokens);
  if (inputTokens === 0 && outputTokens === 0) return;
  const usage = readTokenUsage(scope);
  const previous = usage[provider] ?? {};
  usage[provider] = {
    inputTokens: count(previous.inputTokens) + inputTokens,
    outputTokens: count(previous.outputTokens) + outputTokens,
    updatedAt: Math.floor(Date.now() / 1_000),
  };
  try {
    writeFileSync(scopedStateFile("usage", scope), `${JSON.stringify(usage, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch {
    // Usage accounting must never interrupt an inference response.
  }
}

function parseCodexInference(result) {
  if (!result.ok) throw new Error(result.stderr.trim() || "Codex inference failed.");
  let text;
  let inputTokens;
  let outputTokens;
  for (const line of result.stdout.split("\n")) {
    if (!line.trim()) continue;
    const event = JSON.parse(line);
    if (event.type === "item.completed" && event.item?.type === "agent_message") {
      text = event.item.text;
    }
    if (event.type === "turn.completed") {
      inputTokens = event.usage?.input_tokens;
      outputTokens = event.usage?.output_tokens;
    }
  }
  if (typeof text !== "string") throw new Error("Codex returned no model response.");
  return { text, inputTokens, outputTokens };
}

/**
 * Codex structured output requires every object node to be closed and to list
 * all properties as required. Relay jobs carry the AI SDK's raw tool schemas,
 * so harden nested branches before writing the --output-schema file.
 */
function toStrictJsonSchema(schema) {
  if (!schema || typeof schema !== "object") return schema;
  const strict = { ...schema };
  for (const key of ["anyOf", "allOf", "oneOf"]) {
    if (Array.isArray(strict[key])) {
      strict[key] = strict[key].map(toStrictJsonSchema);
    }
  }
  if (strict.items) {
    strict.items = Array.isArray(strict.items)
      ? strict.items.map(toStrictJsonSchema)
      : toStrictJsonSchema(strict.items);
  }
  for (const key of ["$defs", "definitions"]) {
    if (strict[key] && typeof strict[key] === "object") {
      strict[key] = Object.fromEntries(
        Object.entries(strict[key]).map(([name, value]) => [
          name,
          toStrictJsonSchema(value),
        ])
      );
    }
  }
  if (strict.properties && typeof strict.properties === "object") {
    const properties = Object.entries(strict.properties).map(([name, value]) => [
      name,
      toStrictJsonSchema(value),
    ]);
    strict.properties = Object.fromEntries(properties);
    strict.additionalProperties = false;
    strict.required = properties.map(([name]) => name);
  }
  return strict;
}

async function runInference(provider, invocation) {
  const command = findExecutable(provider);
  if (!command) throw new Error(`${PROVIDERS[provider].executable} was not found.`);
  const modelId = String(invocation.modelId ?? "");
  const prompt = String(invocation.prompt ?? "");
  // Relay jobs represent the provider CLI's automatic/default model with a
  // null model_id. Preserve that capability instead of rejecting it as an
  // empty explicit model selection.
  const useDefaultModel =
    invocation.useDefaultModel === true || !invocation.modelId;
  if (
    (!useDefaultModel && !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(modelId)) ||
    !prompt
  ) {
    throw new Error("Invalid local inference invocation.");
  }
  const responseSchema = invocation.responseSchema ?? null;
  if (invocation.requireAdvertisedModel === true && !useDefaultModel) {
    const models =
      provider === "anthropic"
        ? CLAUDE_MODELS
        : (await codexSnapshot(command)).models;
    if (!models.some(model => model.id === modelId)) {
      throw new Error("The selected model is not advertised by this provider CLI.");
    }
  }
  if (provider === "anthropic") {
    const args = [
      "--print", "--output-format", "json", "--no-session-persistence",
      "--disable-slash-commands", "--no-chrome",
      "--tools=", "--permission-mode", "dontAsk",
    ];
    if (!useDefaultModel) args.push("--model", modelId);
    if (responseSchema) args.push("--json-schema", JSON.stringify(responseSchema));
    const result = await runCommandWithInput(command, args, prompt);
    if (!result.ok) throw new Error(result.stderr.trim() || "Claude inference failed.");
    const value = JSON.parse(result.stdout);
    if (value.is_error || (value.subtype && value.subtype !== "success")) {
      throw new Error(value.result || value.error || "Claude inference failed.");
    }
    const structuredText =
      responseSchema && value.structured_output !== undefined
        ? JSON.stringify(value.structured_output)
        : undefined;
    const text = structuredText ?? value.result;
    if (typeof text !== "string") throw new Error("Claude returned no model response.");
    return {
      text,
      inputTokens: value.usage?.input_tokens,
      outputTokens: value.usage?.output_tokens,
    };
  }
  const args = [
    "exec", "--json", "--ephemeral", "--ignore-user-config", "--ignore-rules",
    "--disable", "apps", "--disable", "plugins", "--disable", "browser_use",
    "--disable", "computer_use", "--disable", "image_generation",
    "--disable", "goals", "--disable", "workspace_dependencies",
    "--disable", "multi_agent", "--skip-git-repo-check", "--sandbox",
    "read-only",
  ];
  if (!useDefaultModel) args.push("--model", modelId);
  let schemaDirectory = null;
  try {
    if (responseSchema) {
      schemaDirectory = mkdtempSync(join(tmpdir(), "ciele-codex-schema-"));
      const schemaPath = join(schemaDirectory, "response.schema.json");
      writeFileSync(schemaPath, JSON.stringify(toStrictJsonSchema(responseSchema)), {
        mode: 0o600,
      });
      args.push("--output-schema", schemaPath);
    }
    args.push("-");
    return parseCodexInference(
      await runCommandWithInput(command, args, prompt)
    );
  } finally {
    if (schemaDirectory) rmSync(schemaDirectory, { recursive: true, force: true });
  }
}

function rateLimitLabel(windowDurationMins) {
  if (windowDurationMins === 300) return "5 hours";
  if (windowDurationMins === 10_080) return "Weekly";
  if (Number.isFinite(windowDurationMins) && windowDurationMins > 0) {
    if (windowDurationMins % 1_440 === 0) {
      const days = windowDurationMins / 1_440;
      return `${days} day${days === 1 ? "" : "s"}`;
    }
    if (windowDurationMins % 60 === 0) {
      const hours = windowDurationMins / 60;
      return `${hours} hour${hours === 1 ? "" : "s"}`;
    }
  }
  return "Usage window";
}

function codexUsage(response) {
  const snapshots = response?.rateLimitsByLimitId;
  const snapshot = snapshots?.codex ?? response?.rateLimits;
  if (!snapshot) return undefined;
  const windows = [snapshot.primary, snapshot.secondary].flatMap(window => {
    if (!window || !Number.isFinite(window.usedPercent)) return [];
    const usedPercent = Math.max(0, Math.min(100, Math.round(window.usedPercent)));
    return [{
      label: rateLimitLabel(window.windowDurationMins),
      usedPercent,
      remainingPercent: 100 - usedPercent,
      ...(Number.isFinite(window.resetsAt) ? { resetsAt: window.resetsAt } : {}),
    }];
  });
  return windows.length > 0 ? { windows } : undefined;
}

function codexModels(response) {
  if (!Array.isArray(response?.data)) return [];
  return response.data.flatMap(model => {
    const id = typeof model?.model === "string" ? model.model : model?.id;
    const label = model?.displayName;
    if (
      model?.hidden ||
      typeof id !== "string" ||
      !/^[a-z0-9][a-z0-9._-]{0,99}$/.test(id) ||
      typeof label !== "string" ||
      !label.trim()
    ) {
      return [];
    }
    const inputModalities = Array.isArray(model.inputModalities)
      ? model.inputModalities.filter(item => item === "text" || item === "image")
      : ["text"];
    return [{ id, label: label.trim(), inputModalities }];
  });
}

function readCodexSnapshot(command, timeout = 6_000) {
  return new Promise(resolve => {
    const invocation = commandInvocation(command, ["app-server", "--stdio"]);
    const child = spawn(invocation.command, invocation.args, {
      stdio: ["pipe", "pipe", "ignore"],
      env: cliEnvironment(),
    });
    let settled = false;
    let buffer = "";
    let models;
    let rateLimits;
    let receivedModels = false;
    let receivedRateLimits = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      resolve(value);
    };
    const timer = setTimeout(() => finish({ models: [], usage: undefined }), timeout);
    child.once("error", () => finish({ models: [], usage: undefined }));
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const message = JSON.parse(line);
          if (message.id === 2) {
            models = codexModels(message.result);
            receivedModels = true;
          }
          if (message.id === 3) {
            rateLimits = codexUsage(message.result);
            receivedRateLimits = true;
          }
          if (receivedModels && receivedRateLimits) {
            finish({ models, usage: rateLimits });
          }
        } catch {
          // Ignore diagnostics that are not JSON-RPC messages.
        }
      }
    });
    child.stdin.write([
      JSON.stringify({
        id: 1,
        method: "initialize",
        params: {
          clientInfo: { name: "ciele-connector", title: "Ciele Connector", version: VERSION },
          capabilities: { experimentalApi: true, requestAttestation: false },
        },
      }),
      JSON.stringify({ method: "initialized" }),
      JSON.stringify({ id: 2, method: "model/list", params: { includeHidden: false, limit: 100 } }),
      JSON.stringify({ id: 3, method: "account/rateLimits/read" }),
      "",
    ].join("\n"));
  });
}

async function codexSnapshot(command) {
  const now = Date.now();
  if (
    codexSnapshotCache?.command === command &&
    codexSnapshotCache.expiresAt > now
  ) {
    return codexSnapshotCache.value;
  }
  const value = await readCodexSnapshot(command);
  codexSnapshotCache = { command, expiresAt: now + 15_000, value };
  return value;
}

function parseCodexStatus(output) {
  if (/logged in using chatgpt/i.test(output)) {
    return { connected: true };
  }
  if (/logged in using (?:an )?api key/i.test(output)) {
    return {
      connected: false,
      error: "Codex is authenticated with an API key, not ChatGPT.",
    };
  }
  return { connected: false };
}

function parseClaudeStatus(output) {
  try {
    const value = JSON.parse(output);
    if (!value.loggedIn) return { connected: false };
    if (value.authMethod !== "claude.ai") {
      return {
        connected: false,
        error: "Claude is not authenticated through claude.ai.",
      };
    }
    return {
      connected: true,
      accountLabel: value.email,
      plan: value.subscriptionType,
    };
  } catch {
    return {
      connected: false,
      error: "Claude returned an unreadable authentication status.",
    };
  }
}

async function providerStatus(provider, scope) {
  const config = PROVIDERS[provider];
  const command = findExecutable(provider);
  const base = {
    provider,
    label: config.label,
    available: Boolean(command),
    connected: false,
    connecting: activeLogins.has(provider),
  };
  if (!command) {
    return {
      ...base,
      models: [],
      error: `${config.executable} was not found on this device.`,
    };
  }
  const result = await runCommand(
    command,
    config.statusArgs,
    provider === "anthropic" ? 15_000 : 8_000
  );
  const parsed =
    provider === "openai"
      ? parseCodexStatus(`${result.stdout}\n${result.stderr}`)
      : parseClaudeStatus(result.stdout);
  if (!parsed.connected) inferenceChecks.delete(provider);
  let inferenceError;
  if (parsed.connected) {
    let check = inferenceChecks.get(provider);
    if (!check) {
      check = runInference(provider, {
        useDefaultModel: true,
        prompt: "Reply with exactly OK.",
      })
        .then(() => null)
        .catch(error =>
          `Login status passed, but inference was rejected: ${error instanceof Error ? error.message : error}`
        );
      inferenceChecks.set(provider, check);
    }
    inferenceError = await check;
  }
  const connected = parsed.connected && !inferenceError;
  const capabilities = connected
    ? provider === "openai"
      ? await codexSnapshot(command)
      : {
          models: CLAUDE_MODELS,
          usage: undefined,
          usageUnavailableReason:
            "Claude Code does not expose a read-only usage command. Input/output tokens are recorded after Preview inference.",
        }
    : { models: [], usage: undefined };
  const tokenUsage = readTokenUsage(scope)[provider];
  return {
    ...base,
    ...parsed,
    ...capabilities,
    ...(tokenUsage ? { tokenUsage } : {}),
    connected,
    error: parsed.error ?? inferenceError ?? lastErrors.get(provider),
  };
}

async function allProviderStatuses(scope) {
  return Promise.all(Object.keys(PROVIDERS).map(provider => providerStatus(provider, scope)));
}

// Provider logins are interactive (they print a URL, prompt, or open a
// browser and wait). A hidden child with no TTY hangs forever, so open the
// login CLI in a visible terminal window the user can complete. The wrapper
// process exits immediately; the status poller detects the finished login.
function spawnInteractiveLogin(invocation) {
  if (process.platform === "win32") {
    // Build the cmd line by hand (verbatim arguments): node's automatic
    // quoting and cmd's quote parsing disagree and corrupt the command.
    // `start` treats its first quoted argument as the window title; the
    // inner `cmd /s /k` keeps the window open so login errors stay visible.
    const quoted = [invocation.command, ...invocation.args]
      .map(part => `"${String(part).replaceAll('"', "")}"`)
      .join(" ");
    return spawn(
      "cmd.exe",
      ["/d", "/s", "/c", `start "Ciele Provider Login" cmd /d /s /k "${quoted}"`],
      {
        stdio: "ignore",
        windowsHide: true,
        windowsVerbatimArguments: true,
        env: cliEnvironment(),
      }
    );
  }
  if (process.platform === "darwin") {
    const shellLine = [invocation.command, ...invocation.args]
      .map(part => `'${String(part).replaceAll("'", `'\\''`)}'`)
      .join(" ");
    return spawn(
      "/usr/bin/osascript",
      [
        "-e",
        'tell application "Terminal" to activate',
        "-e",
        `tell application "Terminal" to do script ${JSON.stringify(shellLine)}`,
      ],
      { stdio: "ignore", env: cliEnvironment() }
    );
  }
  return spawn(invocation.command, invocation.args, {
    stdio: "ignore",
    env: cliEnvironment(),
  });
}

async function startLogin(provider, scope) {
  const config = PROVIDERS[provider];
  const command = findExecutable(provider);
  if (!command) return providerStatus(provider, scope);
  if (activeLogins.has(provider)) return providerStatus(provider, scope);

  lastErrors.delete(provider);
  inferenceChecks.delete(provider);
  const invocation = commandInvocation(command, config.loginArgs);
  const child = spawnInteractiveLogin(invocation);
  activeLogins.set(provider, child);
  child.once("error", () => {
    lastErrors.set(provider, "The provider login process could not start.");
    activeLogins.delete(provider);
  });
  child.once("exit", (code) => {
    if (code !== 0) {
      lastErrors.set(
        provider,
        `Provider login exited with code ${code}. Open the provider CLI for diagnostics.`
      );
    }
    activeLogins.delete(provider);
  });
  return providerStatus(provider, scope);
}

async function logout(provider, scope) {
  const active = activeLogins.get(provider);
  if (active) active.kill();
  activeLogins.delete(provider);
  lastErrors.delete(provider);
  inferenceChecks.delete(provider);
  const config = PROVIDERS[provider];
  const command = findExecutable(provider);
  if (!command) return providerStatus(provider, scope);
  const result = await runCommand(command, config.logoutArgs, 12_000);
  if (!result.ok) throw new Error("The provider CLI could not sign out.");
  return providerStatus(provider, scope);
}

function sanitizePreferences(value) {
  const valid =
    typeof value?.defaultModel === "string" &&
    MODEL_SELECTOR.test(value.defaultModel) &&
    (value.followUpBehavior === "queue" || value.followUpBehavior === "steer");
  if (!valid) return structuredClone(DEFAULT_PREFERENCES);
  return {
    defaultModel: value.defaultModel,
    followUpBehavior: value.followUpBehavior,
  };
}

function readPreferences(scope) {
  try {
    return sanitizePreferences(
      JSON.parse(readFileSync(scopedStateFile("preferences", scope), "utf8"))
    );
  } catch {
    return structuredClone(DEFAULT_PREFERENCES);
  }
}

function savePreferences(scope, value) {
  const preferences = sanitizePreferences(value);
  writeFileSync(scopedStateFile("preferences", scope), `${JSON.stringify(preferences, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return preferences;
}

function readPairing() {
  try {
    const value = JSON.parse(readFileSync(PAIRING_FILE, "utf8"));
    if (
      typeof value.token === "string" &&
      /^[A-Za-z0-9_-]{32,256}$/.test(value.token) &&
      typeof value.scope === "string" &&
      /^[a-f0-9]{64}$/.test(value.scope)
    ) {
      return { token: value.token, scope: value.scope };
    }
  } catch {
    // A freshly installed generic package is intentionally unpaired.
  }
  return null;
}

function savePairing(value) {
  writeFileSync(PAIRING_FILE, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return value;
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", chunk => {
      body += chunk;
      if (body.length > 16 * 1024) reject(new Error("Request body is too large."));
    });
    request.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Request body must be JSON."));
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, status, value, headers) {
  response.writeHead(status, {
    ...headers,
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(value));
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers":
      "Authorization, Content-Type, X-Ciele-Connector-Scope",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Private-Network": "true",
    Vary: "Origin",
  };
}

async function createHandler({ allowedOrigin, initialPairing, bootstrap }) {
  let pairing = initialPairing;
  return async (request, response) => {
    const headers = corsHeaders(allowedOrigin);
    const requestOrigin = request.headers.origin;
    if (requestOrigin !== allowedOrigin) {
      return sendJson(response, 403, { error: "origin_not_allowed" }, headers);
    }
    if (request.method === "OPTIONS") {
      response.writeHead(204, headers);
      return response.end();
    }
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (
      bootstrap &&
      request.method === "GET" &&
      url.pathname === "/v1/bootstrap-status"
    ) {
      return sendJson(response, 200, { paired: Boolean(pairing) }, headers);
    }
    if (
      bootstrap &&
      request.method === "POST" &&
      url.pathname === "/v1/bootstrap"
    ) {
      const body = await readJsonBody(request);
      if (
        typeof body.token !== "string" ||
        !/^[A-Za-z0-9_-]{32,256}$/.test(body.token) ||
        typeof body.scope !== "string" ||
        !/^[a-f0-9]{64}$/.test(body.scope)
      ) {
        return sendJson(response, 400, { error: "invalid_pairing" }, headers);
      }
      pairing = savePairing({ token: body.token, scope: body.scope });
      return sendJson(response, 200, { paired: true }, headers);
    }
    if (!pairing || request.headers.authorization !== `Bearer ${pairing.token}`) {
      return sendJson(response, 401, { error: "invalid_pairing" }, headers);
    }
    if (request.headers["x-ciele-connector-scope"] !== pairing.scope) {
      return sendJson(response, 403, { error: "invalid_scope" }, headers);
    }

    try {
      if (request.method === "GET" && url.pathname === "/v1/status") {
        return sendJson(
          response,
          200,
          {
            version: VERSION,
            providers: await allProviderStatuses(pairing.scope),
            preferences: readPreferences(pairing.scope),
            relayConnected: readRelay()?.scope === pairing.scope,
          },
          headers
        );
      }
      if (request.method === "POST" && url.pathname === "/v1/relay/pair") {
        const body = await readJsonBody(request);
        if (typeof body.code !== "string" || body.code.length < 32) {
          return sendJson(response, 400, { error: "invalid_relay_pairing" }, headers);
        }
        const exchange = await fetch(
          `${allowedOrigin}/api/local-connector/relay/exchange`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: body.code, origin: allowedOrigin }),
          }
        );
        const exchanged = await exchange.json();
        if (!exchange.ok || typeof exchanged.token !== "string") {
          throw new Error(exchanged.error || "Relay pairing failed.");
        }
        saveRelay({
          token: exchanged.token,
          deviceId: exchanged.deviceId,
          scope: pairing.scope,
        });
        return sendJson(response, 200, { relayConnected: true }, headers);
      }
      if (request.method === "PUT" && url.pathname === "/v1/preferences") {
        const preferences = savePreferences(pairing.scope, await readJsonBody(request));
        return sendJson(response, 200, { preferences }, headers);
      }

      const match = url.pathname.match(
        /^\/v1\/providers\/(openai|anthropic)\/(login|logout)$/
      );
      if (request.method === "POST" && match) {
        const [, provider, operation] = match;
        if (provider === "openai") codexSnapshotCache = null;
        const status =
          operation === "login"
            ? await startLogin(provider, pairing.scope)
            : await logout(provider, pairing.scope);
        return sendJson(response, 200, { status }, headers);
      }
      return sendJson(response, 404, { error: "not_found" }, headers);
    } catch (error) {
      return sendJson(
        response,
        500,
        { error: error instanceof Error ? error.message : "Connector error." },
        headers
      );
    }
  };
}

let relayBusy = false;
let cachedRelayProviders = [];
let cachedRelayProvidersAt = 0;

async function relayTick(allowedOrigin) {
  if (relayBusy) return;
  const relay = readRelay();
  if (!relay) return;
  relayBusy = true;
  try {
    if (Date.now() - cachedRelayProvidersAt > 10_000) {
      const statuses = await allProviderStatuses(relay.scope);
      cachedRelayProviders = statuses
        .filter(status => status.connected)
        .map(status => status.provider);
      cachedRelayProvidersAt = Date.now();
    }
    const response = await fetch(`${allowedOrigin}/api/local-connector/relay/jobs`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${relay.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ providers: cachedRelayProviders }),
    });
    if (!response.ok) return;
    const body = await response.json();
    const job = body.job;
    if (!job) return;
    let result;
    let error;
    try {
      result = await runInference(job.provider, {
        modelId: job.model_id,
        prompt: job.invocation?.prompt,
        responseSchema: job.invocation?.responseSchema,
        requireAdvertisedModel: job.invocation?.requireAdvertisedModel === true,
      });
      recordTokenUsage(relay.scope, job.provider, result);
      inferenceChecks.set(job.provider, Promise.resolve(null));
    } catch (caught) {
      error = caught instanceof Error ? caught.message : "Local inference failed.";
      if (/not logged in|log in|login|authenticat|unauthorized/i.test(error)) {
        inferenceChecks.set(
          job.provider,
          Promise.resolve(`Login status passed, but inference was rejected: ${error}`)
        );
        cachedRelayProvidersAt = 0;
      }
    }
    await fetch(`${allowedOrigin}/api/local-connector/relay/jobs`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${relay.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jobId: job.id, result, error }),
    });
  } catch (error) {
    console.error("Ciele relay:", error instanceof Error ? error.message : error);
  } finally {
    relayBusy = false;
  }
}

async function main() {
  const { values, flags } = parseArguments(process.argv.slice(2));
  const allowedOrigin = normalizeOrigin(values.get("--origin") ?? "");
  const rawReturnUrl = values.get("--return-url");
  const returnUrl = rawReturnUrl ? new URL(rawReturnUrl) : null;
  if (returnUrl && returnUrl.origin !== allowedOrigin) {
    throw new Error("The return URL must use the allowed Ciele origin.");
  }
  const bootstrap = flags.has("--bootstrap");
  const argumentToken = values.get("--token");
  const argumentScope = values.get("--scope");
  const initialPairing = bootstrap
    ? readPairing()
    : {
        token: argumentToken ?? randomBytes(32).toString("base64url"),
        scope: argumentScope ?? "",
      };
  if (
    initialPairing &&
    (!/^[A-Za-z0-9_-]{6,256}$/.test(initialPairing.token) ||
      !/^[a-f0-9]{64}$/.test(initialPairing.scope))
  ) {
    throw new Error("Invalid connector pairing.");
  }
  const requestedPort = Number(values.get("--port") ?? 0);
  if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) {
    throw new Error("Invalid connector port.");
  }

  const handler = await createHandler({
    allowedOrigin,
    initialPairing,
    bootstrap,
  });
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(requestedPort, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Connector did not obtain a loopback port.");
  }

  console.log(`Ciele Connector ${VERSION} listening on 127.0.0.1:${address.port}`);
  writeFileSync(PID_FILE, String(process.pid), { encoding: "utf8", mode: 0o600 });
  process.once("exit", () => rmSync(PID_FILE, { force: true }));
  const relayTimer = setInterval(() => {
    void relayTick(allowedOrigin);
  }, 1_000);
  relayTimer.unref();
  void relayTick(allowedOrigin);
  if (!flags.has("--no-open") && returnUrl && initialPairing) {
    returnUrl.hash = new URLSearchParams({
      connectorPort: String(address.port),
      connectorToken: initialPairing.token,
      connectorScope: initialPairing.scope,
    }).toString();
    openExternalUrl(returnUrl.toString());
  }

  const close = () => {
    clearInterval(relayTimer);
    rmSync(PID_FILE, { force: true });
    server.close(() => process.exit(0));
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
