import { afterEach, describe, expect, it, vi } from "vitest";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { CONNECTOR_FILENAME } from "./local-connector-installer";
import { CURRENT_CONNECTOR_VERSION } from "./local-connector-protocol";

const ORIGIN = "https://ciele.example.com";
const TOKEN = "connector_test_token_1234567890";
/**
 * These cases spawn the real connector process and talk to it over HTTP, so
 * every wait needs a deadline or a hang becomes a hung suite. The deadline is a
 * safety net, not an assertion about latency, keep it well clear of what a
 * contended machine needs (turbo runs this suite alongside the agent package's).
 */
const CONNECTOR_DEADLINE_MS = 60_000;
// Each case spawns the connector, which in turn spawns 5–7 short-lived node
// child processes (CLI status probes, an inference check per provider, the
// codex app-server snapshot, then the job inference itself), paced by the
// connector's 1s relay tick. That is real wall clock no fake timer can absorb,
// a single case has taken >10s on an idle machine, so this file overrides
// the suite-wide 15s testTimeout instead of asserting latency it cannot
// control. Keep it above CONNECTOR_DEADLINE_MS so a hang fails with that
// deadline's descriptive error rather than a bare vitest timeout.
vi.setConfig({ testTimeout: 90_000 });
const SCOPE = "a".repeat(64);
const children: ChildProcess[] = [];
const directories: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) child.kill("SIGTERM");
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolveClose) => server.close(() => resolveClose()))
    )
  );
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

async function executable(directory: string, name: string, source: string) {
  const path = join(directory, name);
  await writeFile(path, `#!/usr/bin/env node\n${source}`, "utf8");
  await chmod(path, 0o755);
  return path;
}

async function startConnector(
  options: {
    includeUsage?: boolean;
    origin?: string;
    claudeUsageUrl?: string;
  } = {}
) {
  const directory = await mkdtemp(join(tmpdir(), "ciele-connector-test-"));
  directories.push(directory);
  const codex = await executable(
    directory,
    "codex",
    String.raw`
const args = process.argv.slice(2);
if (args[0] === "login" && args[1] === "status") {
  console.log("Logged in using ChatGPT");
  process.exit(0);
}
if (args[0] === "exec") {
  const schemaIndex = args.indexOf("--output-schema");
  if (schemaIndex >= 0) {
    const schema = JSON.parse(require("node:fs").readFileSync(args[schemaIndex + 1], "utf8"));
    const isStrict = value => {
      if (!value || typeof value !== "object") return true;
      if (Array.isArray(value)) return value.every(isStrict);
      if (value.properties) {
        const keys = Object.keys(value.properties);
        if (value.additionalProperties !== false) return false;
        if (!Array.isArray(value.required) || keys.some(key => !value.required.includes(key))) return false;
      }
      return Object.values(value).every(isStrict);
    };
    if (!isStrict(schema)) {
      console.error("invalid input syntax for type json");
      process.exit(1);
    }
  }
  process.stdin.resume();
  process.stdin.on("end", () => {
    console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "OK" } }));
    console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 2, output_tokens: 1 } }));
  });
} else {
if (args[0] !== "app-server") process.exit(1);
process.stdin.setEncoding("utf8");
let buffer = "";
process.stdin.on("data", chunk => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop() || "";
  for (const line of lines) {
    if (!line.trim()) continue;
    const request = JSON.parse(line);
    if (request.method === "initialize") {
      console.log(JSON.stringify({ id: request.id, result: { userAgent: "fake" } }));
    }
    if (request.method === "model/list") {
      setTimeout(() => console.log(JSON.stringify({ id: request.id, result: { data: [
        { id: "gpt-5.6-sol", model: "gpt-5.6-sol", displayName: "GPT-5.6-Sol", hidden: false, inputModalities: ["text", "image"] }
      ], nextCursor: null } })), 20);
    }
    if (request.method === "account/rateLimits/read") {
      setTimeout(() => console.log(JSON.stringify({ id: request.id, result: ${options.includeUsage === false ? "{ rateLimits: null, rateLimitsByLimitId: null, rateLimitResetCredits: null }" : `{ rateLimits: {
        limitId: "codex", primary: { usedPercent: 64, windowDurationMins: 10080, resetsAt: 1800000000 }, secondary: null
      }, rateLimitsByLimitId: null, rateLimitResetCredits: null }`} })), 25);
    }
  }
});
process.stdin.on("end", () => process.exit(0));
}
`
  );
  const claude = await executable(
    directory,
    "claude",
    String.raw`
const args = process.argv.slice(2);
if (args.join(" ") === "auth status --json") {
  console.log(JSON.stringify({ loggedIn: true, authMethod: "claude.ai", email: "member@example.com", subscriptionType: "max" }));
  process.exit(0);
}
if (args.includes("--print")) {
  if (args.includes("--json-schema")) {
    console.log(JSON.stringify({
      type: "result",
      subtype: "success",
      result: "Nel sito di Alex risultano quattro lavori.",
      structured_output: { kind: "text", text: "Nel sito di Alex risultano quattro lavori.", toolName: null, input: null },
      usage: { input_tokens: 8, output_tokens: 4 }
    }));
    process.exit(0);
  }
  console.log(JSON.stringify({ type: "result", subtype: "success", result: "OK", usage: { input_tokens: 2, output_tokens: 1 } }));
  process.exit(0);
}
process.exit(1);
`
  );
  // Derived, not spelled out: a version bump should re-point this suite at the
  // new artifact rather than time out spawning one that is no longer there.
  const runtime = resolve(
    process.cwd(),
    `public/connectors/${CONNECTOR_FILENAME}`
  );
  const child = spawn(
    process.execPath,
    [
      runtime,
      "--origin",
      options.origin ?? ORIGIN,
      "--return-url",
      `${options.origin ?? ORIGIN}/settings/ai`,
      "--scope",
      SCOPE,
      "--token",
      TOKEN,
      "--port",
      "0",
      "--no-open",
    ],
    {
      env: {
        ...process.env,
        CIELE_CONNECTOR_HOME: directory,
        CODEX_CLI_PATH: codex,
        CLAUDE_CLI_PATH: claude,
        // Keep the suite hermetic: point the Claude credential lookup at the
        // temp home and disable the usage endpoint unless a test serves one.
        CLAUDE_CONFIG_DIR: directory,
        CIELE_CLAUDE_USAGE_URL: options.claudeUsageUrl ?? "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  children.push(child);
  const port = await new Promise<number>((resolvePort, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("Connector did not start")), CONNECTOR_DEADLINE_MS);
    child.once("error", reject);
    child.stdout?.on("data", (chunk) => {
      output += chunk.toString();
      const match = output.match(/127\.0\.0\.1:(\d+)/);
      if (!match) return;
      clearTimeout(timer);
      resolvePort(Number(match[1]));
    });
  });
  const request = (path: string, init: RequestInit = {}) =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      ...init,
      headers: {
        Origin: options.origin ?? ORIGIN,
        Authorization: `Bearer ${TOKEN}`,
        "X-Ciele-Connector-Scope": SCOPE,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
  return { request, directory };
}

async function startRelayServer(options: {
  provider: "openai" | "anthropic";
  modelId?: string | null;
  responseSchema?: Record<string, unknown>;
}) {
  let delivered = false;
  let resolveCompletion!: (body: Record<string, unknown>) => void;
  const completion = new Promise<Record<string, unknown>>((resolve) => {
    resolveCompletion = resolve;
  });
  const server = createServer((request, response) => {
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      raw += chunk;
    });
    request.on("end", () => {
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      response.setHeader("Content-Type", "application/json");
      if (request.url === "/api/local-connector/relay/exchange") {
        response.end(JSON.stringify({ token: "r".repeat(48), deviceId: "device-1" }));
        return;
      }
      if (request.url === "/api/local-connector/relay/jobs" && request.method === "PATCH") {
        resolveCompletion(body);
        response.end(JSON.stringify({ ok: true }));
        return;
      }
      if (request.url === "/api/local-connector/relay/jobs") {
        const job = delivered
          ? null
          : {
              id: "job-1",
              provider: options.provider,
              model_id: options.modelId ?? null,
              invocation: {
                prompt: "Reply with exactly OK.",
                responseSchema: options.responseSchema ?? null,
              },
            };
        delivered = true;
        response.end(JSON.stringify({ job }));
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ error: "not_found" }));
    });
  });
  await new Promise<void>((resolveListen) =>
    server.listen(0, "127.0.0.1", resolveListen)
  );
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Relay did not start");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    completion,
  };
}

describe.skipIf(process.platform === "win32")("local connector runtime", () => {
  it.each(["openai", "anthropic"] as const)(
    "uses the %s CLI default model for a relayed job without a model id",
    async (provider) => {
      const relay = await startRelayServer({ provider });
      const { request } = await startConnector({ origin: relay.origin });

      const paired = await request("/v1/relay/pair", {
        method: "POST",
        body: JSON.stringify({ code: "p".repeat(32) }),
      });
      expect(paired.ok).toBe(true);

      const completed = await Promise.race([
        relay.completion,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Relay inference timed out")), CONNECTOR_DEADLINE_MS)
        ),
      ]);
      expect(completed.error).toBeUndefined();
      expect(completed.result).toMatchObject({ text: "OK" });
    }
  );

  it("strictifies nested tool schemas before relaying them to Codex", async () => {
    const relay = await startRelayServer({
      provider: "openai",
      modelId: "gpt-5.6-luna",
      responseSchema: {
        type: "object",
        properties: {
          kind: { enum: ["text", "tool_call"] },
          input: {
            anyOf: [
              {
                type: "object",
                properties: { query: { type: "string" } },
              },
              { type: "null" },
            ],
          },
        },
        required: ["kind", "input"],
        additionalProperties: false,
      },
    });
    const { request } = await startConnector({ origin: relay.origin });

    const paired = await request("/v1/relay/pair", {
      method: "POST",
      body: JSON.stringify({ code: "p".repeat(32) }),
    });
    expect(paired.ok).toBe(true);

    const completed = await Promise.race([
      relay.completion,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Relay inference timed out")), CONNECTOR_DEADLINE_MS)
      ),
    ]);
    expect(completed.error).toBeUndefined();
    expect(completed.result).toMatchObject({ text: "OK" });
  });

  it("relays Claude structured_output instead of its natural-language result", async () => {
    const relay = await startRelayServer({
      provider: "anthropic",
      modelId: "opus",
      responseSchema: {
        type: "object",
        properties: {
          kind: { enum: ["text", "tool_call"] },
          text: { type: ["string", "null"] },
          toolName: { enum: ["searchKnowledge", null] },
          input: { type: ["object", "null"] },
        },
        required: ["kind", "text", "toolName", "input"],
      },
    });
    const { request } = await startConnector({ origin: relay.origin });

    const paired = await request("/v1/relay/pair", {
      method: "POST",
      body: JSON.stringify({ code: "p".repeat(32) }),
    });
    expect(paired.ok).toBe(true);

    const completed = await Promise.race([
      relay.completion,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Relay inference timed out")), CONNECTOR_DEADLINE_MS)
      ),
    ]);
    expect(completed.error).toBeUndefined();
    expect(completed.result).toMatchObject({
      text: JSON.stringify({
        kind: "text",
        text: "Nel sito di Alex risultano quattro lavori.",
        toolName: null,
        input: null,
      }),
    });
  });

  it("reports Claude usage windows from the OAuth usage endpoint", async () => {
    const usageServer = createServer((_request, response) => {
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          limits: [
            {
              kind: "session",
              percent: 16,
              resets_at: "2026-07-31T11:40:00.000000+00:00",
            },
            {
              kind: "weekly_all",
              percent: 78,
              resets_at: "2026-08-01T13:59:59.000000+00:00",
            },
            {
              kind: "weekly_scoped",
              scope: { model: { id: null, display_name: "Fable" }, surface: null },
              percent: 11,
              resets_at: "2026-08-01T14:00:00.000000+00:00",
            },
            { kind: "broken", percent: null, resets_at: null },
          ],
        })
      );
    });
    servers.push(usageServer);
    await new Promise<void>((resolveListen) =>
      usageServer.listen(0, "127.0.0.1", resolveListen)
    );
    const address = usageServer.address();
    if (!address || typeof address === "string") throw new Error("No usage port");
    const { request, directory } = await startConnector({
      claudeUsageUrl: `http://127.0.0.1:${address.port}/api/oauth/usage`,
    });
    await writeFile(
      join(directory, ".credentials.json"),
      JSON.stringify({ claudeAiOauth: { accessToken: "sk-ant-oat-test" } }),
      "utf8"
    );

    const status = await (await request("/v1/status")).json();
    const anthropic = status.providers.find(
      (provider: { provider: string }) => provider.provider === "anthropic"
    );

    expect(anthropic.connected).toBe(true);
    expect(anthropic.usage).toEqual({
      windows: [
        {
          label: "5-hour limit",
          usedPercent: 16,
          remainingPercent: 84,
          resetsAt: Math.round(Date.parse("2026-07-31T11:40:00.000000+00:00") / 1_000),
        },
        {
          label: "Weekly · all models",
          usedPercent: 78,
          remainingPercent: 22,
          resetsAt: Math.round(Date.parse("2026-08-01T13:59:59.000000+00:00") / 1_000),
        },
        {
          label: "Weekly · Fable",
          usedPercent: 11,
          remainingPercent: 89,
          resetsAt: Math.round(Date.parse("2026-08-01T14:00:00.000000+00:00") / 1_000),
        },
      ],
    });
  });

  it("reports no Claude usage when the CLI credentials are unreadable", async () => {
    const { request } = await startConnector({
      claudeUsageUrl: "http://127.0.0.1:9/api/oauth/usage",
    });
    const status = await (await request("/v1/status")).json();
    const anthropic = status.providers.find(
      (provider: { provider: string }) => provider.provider === "anthropic"
    );

    expect(anthropic.connected).toBe(true);
    expect(anthropic.usage).toBeUndefined();
    expect(anthropic.usageUnavailableReason).toContain("could not be read");
  });

  it("keeps the Codex model catalog when no rate-limit window is reported", async () => {
    const { request } = await startConnector({ includeUsage: false });
    const status = await (await request("/v1/status")).json();
    const openai = status.providers.find(
      (provider: { provider: string }) => provider.provider === "openai"
    );

    expect(openai.models).toEqual([
      expect.objectContaining({ id: "gpt-5.6-sol" }),
    ]);
    expect(openai.usage).toBeUndefined();
  });

  it("reports real CLI models, rate-limit usage and persists routing preferences", async () => {
    const { request, directory } = await startConnector();
    await writeFile(
      join(directory, `usage.${SCOPE}.json`),
      JSON.stringify({
        openai: { inputTokens: 42, outputTokens: 11, updatedAt: 1_800_000_001 },
        anthropic: { inputTokens: 18, outputTokens: 7, updatedAt: 1_800_000_002 },
      }),
      "utf8"
    );
    await writeFile(
      join(directory, `usage.${"b".repeat(64)}.json`),
      JSON.stringify({
        openai: { inputTokens: 99_999, outputTokens: 99_999 },
      }),
      "utf8"
    );
    const status = await (await request("/v1/status")).json();
    // The spawned artifact must report the version the app upgrade-gates on,
    // or every installed connector is told to upgrade to what it already runs.
    expect(status.version).toBe(CURRENT_CONNECTOR_VERSION);

    expect(status.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "openai",
          connected: true,
          models: [
            expect.objectContaining({ id: "gpt-5.6-sol", label: "GPT-5.6-Sol" }),
          ],
          usage: {
            windows: [
              expect.objectContaining({
                label: "Weekly",
                usedPercent: 64,
                remainingPercent: 36,
              }),
            ],
          },
          tokenUsage: {
            inputTokens: 42,
            outputTokens: 11,
            updatedAt: 1_800_000_001,
          },
        }),
        expect.objectContaining({
          provider: "anthropic",
          connected: true,
          models: expect.arrayContaining([
            expect.objectContaining({ id: "opus", label: "Claude Opus" }),
          ]),
          tokenUsage: {
            inputTokens: 18,
            outputTokens: 7,
            updatedAt: 1_800_000_002,
          },
        }),
      ])
    );

    const preferences = {
      defaultModel: "local:anthropic:opus",
      followUpBehavior: "steer",
    };
    const saved = await (
      await request("/v1/preferences", {
        method: "PUT",
        body: JSON.stringify(preferences),
      })
    ).json();
    expect(saved.preferences).toEqual(preferences);
    expect((await (await request("/v1/status")).json()).preferences).toEqual(
      preferences
    );
  });
});
