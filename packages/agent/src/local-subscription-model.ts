import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  JSONSchema7,
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3Prompt,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
} from "@ai-sdk/provider";
import {
  localSubscriptionCliEnvironment,
  localSubscriptionCommand,
  localSubscriptionInvocation,
  type LocalSubscriptionProvider,
} from "./local-subscriptions";

export interface LocalCliInvocation {
  provider: LocalSubscriptionProvider;
  /** Omit only for a readiness probe that uses the provider CLI's default model. */
  modelId?: string;
  /** Require the connector to verify this user-selected ID against its live catalog. */
  requireAdvertisedModel?: boolean;
  prompt: string;
  responseSchema?: JSONSchema7;
  signal?: AbortSignal;
}

export interface LocalCliResult {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
}

export type LocalCliRunner = (
  invocation: LocalCliInvocation
) => Promise<LocalCliResult>;

export interface LocalCommandInvocation {
  command: string;
  args: string[];
  stdin: string;
  signal?: AbortSignal;
}

export interface LocalCommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type LocalCommandExecutor = (
  invocation: LocalCommandInvocation
) => Promise<LocalCommandResult>;

const MAX_CLI_OUTPUT = 4 * 1024 * 1024;

export const executeLocalCommand: LocalCommandExecutor = ({
  command,
  args,
  stdin,
  signal,
}) =>
  new Promise((resolve, reject) => {
    const invocation = localSubscriptionInvocation(command, args);
    const child = spawn(invocation.command, invocation.args, {
      env: localSubscriptionCliEnvironment(),
      stdio: ["pipe", "pipe", "pipe"],
      signal,
    });
    let stdout = "";
    let stderr = "";
    const append = (current: string, chunk: Buffer) => {
      const next = current + chunk.toString("utf8");
      if (next.length > MAX_CLI_OUTPUT) {
        child.kill();
        throw new Error("The local provider response exceeded the size limit.");
      }
      return next;
    };
    child.stdout.on("data", (chunk: Buffer) => {
      try {
        stdout = append(stdout, chunk);
      } catch (error) {
        reject(error);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      try {
        stderr = append(stderr, chunk);
      } catch (error) {
        reject(error);
      }
    });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.stdin.end(stdin);
  });

function parseClaudeResult(
  result: LocalCommandResult,
  responseSchema?: JSONSchema7
): LocalCliResult {
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || "Claude CLI inference failed.");
  }
  const value = JSON.parse(result.stdout) as {
    subtype?: string;
    is_error?: boolean;
    result?: string;
    structured_output?: unknown;
    usage?: { input_tokens?: number; output_tokens?: number };
    error?: string;
  };
  if (value.subtype && value.subtype !== "success") {
    throw new Error(value.error || "Claude CLI inference failed.");
  }
  if (value.is_error) {
    throw new Error(value.result || value.error || "Claude CLI inference failed.");
  }
  const structuredText =
    responseSchema && value.structured_output !== undefined
      ? JSON.stringify(value.structured_output)
      : undefined;
  const text = structuredText ?? value.result;
  if (typeof text !== "string") {
    throw new Error("Claude CLI returned no model response.");
  }
  return {
    text,
    inputTokens: value.usage?.input_tokens,
    outputTokens: value.usage?.output_tokens,
  };
}

function parseCodexResult(result: LocalCommandResult): LocalCliResult {
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || "Codex CLI inference failed.");
  }
  let text: string | undefined;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  for (const line of result.stdout.split("\n")) {
    if (!line.trim()) continue;
    const event = JSON.parse(line) as {
      type?: string;
      item?: { type?: string; text?: string };
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    if (
      event.type === "item.completed" &&
      event.item?.type === "agent_message" &&
      typeof event.item.text === "string"
    ) {
      text = event.item.text;
    }
    if (event.type === "turn.completed") {
      inputTokens = event.usage?.input_tokens;
      outputTokens = event.usage?.output_tokens;
    }
  }
  if (text === undefined) throw new Error("Codex CLI returned no model response.");
  return { text, inputTokens, outputTokens };
}

/**
 * OpenAI structured outputs (which Codex's `--output-schema` compiles to)
 * are strict: EVERY object node must set `additionalProperties: false` and
 * list all of its properties in `required`. The tool-response envelope embeds
 * each Ciele tool's raw `inputSchema` (from the AI SDK), which sets neither, so
 * Codex rejects the whole schema with `invalid_json_schema` (400), the
 * `search_knowledge` turn then fails while a bare classification schema, which
 * is already strict, succeeds. Recursively harden any schema before handing it
 * to Codex. Idempotent, so an already-strict schema passes through unchanged.
 */
function toStrictJsonSchema(schema: JSONSchema7): JSONSchema7 {
  if (!schema || typeof schema !== "object") return schema;
  const s = { ...schema } as Record<string, unknown>;
  for (const key of ["anyOf", "allOf", "oneOf"] as const) {
    const branch = s[key];
    if (Array.isArray(branch)) {
      s[key] = branch.map((b) => toStrictJsonSchema(b as JSONSchema7));
    }
  }
  if (s.items) {
    s.items = Array.isArray(s.items)
      ? s.items.map((i) => toStrictJsonSchema(i as JSONSchema7))
      : toStrictJsonSchema(s.items as JSONSchema7);
  }
  for (const defs of ["$defs", "definitions"] as const) {
    const bucket = s[defs];
    if (bucket && typeof bucket === "object") {
      s[defs] = Object.fromEntries(
        Object.entries(bucket as Record<string, unknown>).map(([k, v]) => [
          k,
          toStrictJsonSchema(v as JSONSchema7),
        ])
      );
    }
  }
  const props = s.properties;
  if (props && typeof props === "object") {
    const entries = Object.entries(props as Record<string, unknown>).map(
      ([k, v]) => [k, toStrictJsonSchema(v as JSONSchema7)] as const
    );
    s.properties = Object.fromEntries(entries);
    s.additionalProperties = false;
    s.required = entries.map(([k]) => k);
  }
  return s as JSONSchema7;
}

export function createLocalCliRunner(
  execute: LocalCommandExecutor = executeLocalCommand
): LocalCliRunner {
  return async ({ provider, modelId, prompt, responseSchema, signal }) => {
    const command = localSubscriptionCommand(provider);
    if (provider === "anthropic") {
      const args = [
        "--print",
        "--output-format",
        "json",
        "--no-session-persistence",
        "--disable-slash-commands",
        "--no-chrome",
        "--tools",
        "",
        "--permission-mode",
        "dontAsk",
      ];
      if (modelId) args.push("--model", modelId);
      if (responseSchema) {
        args.push("--json-schema", JSON.stringify(responseSchema));
      }
      return parseClaudeResult(
        await execute({ command, args, stdin: prompt, signal }),
        responseSchema
      );
    }
    const args = [
      "exec",
      "--json",
      "--ephemeral",
      "--ignore-user-config",
      "--ignore-rules",
      "--disable",
      "apps",
      "--disable",
      "plugins",
      "--disable",
      "browser_use",
      "--disable",
      "computer_use",
      "--disable",
      "image_generation",
      "--disable",
      "goals",
      "--disable",
      "workspace_dependencies",
      "--disable",
      "multi_agent",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
    ];
    if (modelId) args.push("--model", modelId);
    let schemaDirectory: string | null = null;
    try {
      if (responseSchema) {
        schemaDirectory = await mkdtemp(join(tmpdir(), "ciele-codex-schema-"));
        const schemaPath = join(schemaDirectory, "response.schema.json");
        await writeFile(schemaPath, JSON.stringify(toStrictJsonSchema(responseSchema)), {
          encoding: "utf8",
          mode: 0o600,
        });
        args.push("--output-schema", schemaPath);
      }
      args.push("-");
      return parseCodexResult(
        await execute({ command, args, stdin: prompt, signal })
      );
    } finally {
      if (schemaDirectory) {
        await rm(schemaDirectory, { recursive: true, force: true });
      }
    }
  };
}

interface ReadinessProbe {
  ready: Promise<boolean>;
  startedAt: number;
  /** Set when `ready` resolves, so age is only judged on a settled verdict. */
  verdict?: boolean;
}

const readinessProbes = new Map<LocalSubscriptionProvider, ReadinessProbe>();

/**
 * A ready CLI stays ready for a while; a refusal must not stick, because the
 * usual cause is a sign-in the Member is about to complete in their terminal,
 * re-probing soon is how `codex login` / `claude auth login` takes effect
 * without restarting the dev server.
 */
const READY_TTL_MS = 10 * 60_000;
const NOT_READY_TTL_MS = 10_000;

export function clearLocalSubscriptionReadinessProbe(
  provider: LocalSubscriptionProvider
): void {
  readinessProbes.delete(provider);
}

/**
 * `auth status` can be stale (Claude has been observed reporting logged-in
 * while `--print` returns “Not logged in”). Probe with the CLI default model
 * before advertising a direct-local capability to Preview, and cache the
 * verdict for the TTL above.
 */
export async function verifiedLocalSubscriptionProviders(
  providers: LocalSubscriptionProvider[],
  run: LocalCliRunner = createLocalCliRunner(),
  now: number = Date.now()
): Promise<LocalSubscriptionProvider[]> {
  const verified = await Promise.all(
    providers.map(async (provider) => {
      const cached = readinessProbes.get(provider);
      // A probe still in flight is reused regardless of age; a settled one
      // expires on the TTL for the verdict it reached.
      const expired =
        cached?.verdict !== undefined &&
        now - cached.startedAt >
          (cached.verdict ? READY_TTL_MS : NOT_READY_TTL_MS);
      let probe = expired ? undefined : cached;
      if (!probe) {
        const next: ReadinessProbe = {
          startedAt: now,
          ready: run({ provider, prompt: "Reply with exactly OK." })
            .then(() => true)
            .catch(() => false),
        };
        next.ready.then((verdict) => {
          next.verdict = verdict;
        });
        probe = next;
        readinessProbes.set(provider, probe);
      }
      return (await probe.ready) ? provider : null;
    })
  );
  return verified.filter(
    (provider): provider is LocalSubscriptionProvider => provider !== null
  );
}

function serializePrompt(prompt: LanguageModelV3Prompt): string {
  return prompt
    .map((message) => {
      if (message.role === "system") return `SYSTEM:\n${message.content}`;
      const content = message.content
        .map((part) => {
          if (part.type === "text" || part.type === "reasoning") return part.text;
          if (part.type === "file") {
            return `[File omitted: ${part.filename ?? part.mediaType}]`;
          }
          if (part.type === "tool-call") {
            return `[Tool call ${part.toolName}: ${JSON.stringify(part.input)}]`;
          }
          if (part.type === "tool-result") {
            return `[Tool result ${part.toolName}: ${JSON.stringify(part.output)}]`;
          }
          if (part.type === "tool-approval-response") {
            return `[Tool approval ${part.approvalId}: ${part.approved ? "approved" : "denied"}]`;
          }
          return "";
        })
        .filter(Boolean)
        .join("\n");
      return `${message.role.toUpperCase()}:\n${content}`;
    })
    .join("\n\n");
}

function usageOf(result: LocalCliResult): LanguageModelV3Usage {
  return {
    inputTokens: {
      total: result.inputTokens,
      noCache: result.inputTokens,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: result.outputTokens,
      text: result.outputTokens,
      reasoning: undefined,
    },
  };
}

function toolResponseSchema(
  options: LanguageModelV3CallOptions
): JSONSchema7 | undefined {
  const tools = (options.tools ?? []).filter((tool) => tool.type === "function");
  if (tools.length === 0 || options.toolChoice?.type === "none") return undefined;
  const chosenToolName =
    options.toolChoice?.type === "tool" ? options.toolChoice.toolName : null;
  const selected =
    chosenToolName
      ? tools.filter((tool) => tool.name === chosenToolName)
      : tools;
  const mayAnswer = !options.toolChoice || options.toolChoice.type === "auto";
  return {
    type: "object",
    properties: {
      kind: { enum: mayAnswer ? ["text", "tool_call"] : ["tool_call"] },
      text: { type: ["string", "null"] },
      toolName: { enum: [...selected.map((tool) => tool.name), null] },
      // anyOf, not oneOf: OpenAI structured output (Codex) rejects oneOf, and
      // two Ciele tools can share an input shape (which would make oneOf fail
      // validation even where it is supported).
      input: {
        anyOf: [...selected.map((tool) => tool.inputSchema), { type: "null" }],
      },
    },
    required: ["kind", "text", "toolName", "input"],
    additionalProperties: false,
  };
}

function toolInstructions(options: LanguageModelV3CallOptions): string {
  const tools = (options.tools ?? []).filter((tool) => tool.type === "function");
  if (tools.length === 0 || options.toolChoice?.type === "none") return "";
  return [
    "AVAILABLE CIELE TOOLS:",
    ...tools.map(
      (tool) =>
        `- ${tool.name}: ${tool.description ?? ""}\n  input schema: ${JSON.stringify(tool.inputSchema)}`
    ),
    "Return exactly one JSON object matching the supplied output schema. Choose kind=tool_call when a Ciele tool is needed; otherwise choose kind=text. Set fields unused by that kind to null. Never execute tools yourself.",
  ].join("\n");
}

export function createLocalSubscriptionModel(input: {
  provider: LocalSubscriptionProvider;
  modelId: string;
  /** `null` uses the provider CLI default; omitted keeps direct callers compatible. */
  cliModelId?: string | null;
  run: LocalCliRunner;
}): LanguageModelV3 {
  const { provider, modelId, run } = input;
  const cliModelId = input.cliModelId === null
    ? undefined
    : input.cliModelId ?? modelId;

  async function generate(
    options: LanguageModelV3CallOptions
  ): Promise<LanguageModelV3GenerateResult> {
    const toolsSchema = toolResponseSchema(options);
    const instructions = toolInstructions(options);
    const result = await run({
      provider,
      modelId: cliModelId,
      requireAdvertisedModel: Boolean(cliModelId),
      prompt: [serializePrompt(options.prompt), instructions]
        .filter(Boolean)
        .join("\n\n"),
      responseSchema:
        options.responseFormat?.type === "json"
          ? options.responseFormat.schema
          : toolsSchema,
      signal: options.abortSignal,
    });
    if (toolsSchema) {
      let envelope: {
        kind?: string;
        text?: string;
        toolName?: string;
        input?: unknown;
      };
      try {
        envelope = JSON.parse(result.text) as typeof envelope;
      } catch (error) {
        // Claude can return a natural-language `result` after a successful
        // tool result even when the CLI was given `--json-schema`. Older
        // connectors forwarded that text instead of `structured_output`.
        // In auto tool mode, natural text is a valid terminal answer.
        if (provider === "anthropic" && result.text.trim()) {
          return {
            content: [{ type: "text", text: result.text }],
            finishReason: { unified: "stop", raw: "stop" },
            usage: usageOf(result),
            warnings: [],
            response: { modelId },
          };
        }
        throw error;
      }
      if (envelope.kind === "tool_call" && envelope.toolName) {
        return {
          content: [
            {
              type: "tool-call",
              toolCallId: randomUUID(),
              toolName: envelope.toolName,
              input: JSON.stringify(envelope.input ?? {}),
            },
          ],
          finishReason: { unified: "tool-calls", raw: "tool-calls" },
          usage: usageOf(result),
          warnings: [],
          response: { modelId },
        };
      }
      if (envelope.kind === "text" && typeof envelope.text === "string") {
        return {
          content: [{ type: "text", text: envelope.text }],
          finishReason: { unified: "stop", raw: "stop" },
          usage: usageOf(result),
          warnings: [],
          response: { modelId },
        };
      }
      throw new Error("The local provider returned an invalid Ciele tool response.");
    }
    return {
      content: [{ type: "text", text: result.text }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: usageOf(result),
      warnings: [],
      response: { modelId },
    };
  }

  return {
    specificationVersion: "v3",
    provider: `ciele.local-${provider}`,
    modelId,
    supportedUrls: {},
    doGenerate: generate,
    async doStream(options) {
      const result = await generate(options);
      const id = randomUUID();
      const contentParts: LanguageModelV3StreamPart[] = [];
      for (const content of result.content) {
        if (content.type === "text") {
          contentParts.push(
            { type: "text-start", id },
            { type: "text-delta", id, delta: content.text },
            { type: "text-end", id }
          );
        } else if (content.type === "tool-call") {
          contentParts.push(content);
        }
      }
      const parts: LanguageModelV3StreamPart[] = [
        { type: "stream-start", warnings: result.warnings },
        { type: "response-metadata", modelId },
        ...contentParts,
        {
          type: "finish",
          usage: result.usage,
          finishReason: result.finishReason,
        },
      ];
      return { stream: new ReadableStream({ start: (controller) => {
        for (const part of parts) controller.enqueue(part);
        controller.close();
      } }) };
    },
  };
}
