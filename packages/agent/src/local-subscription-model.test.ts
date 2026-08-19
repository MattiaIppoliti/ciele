import { generateObject, stepCountIs, streamText, tool } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// Pin the resolved CLI commands so assertions don't depend on what happens to
// be installed on the machine running the suite (command resolution probes
// PATH and well-known install locations).
beforeEach(() => {
  vi.stubEnv("CODEX_CLI_PATH", "codex");
  vi.stubEnv("CLAUDE_CLI_PATH", "claude");
  return () => vi.unstubAllEnvs();
});
import {
  clearLocalSubscriptionReadinessProbe,
  createLocalCliRunner,
  createLocalSubscriptionModel,
  verifiedLocalSubscriptionProviders,
} from "./local-subscription-model";

describe("createLocalSubscriptionModel", () => {
  it("advertises only subscriptions that pass a real default-model inference probe", async () => {
    clearLocalSubscriptionReadinessProbe("openai");
    clearLocalSubscriptionReadinessProbe("anthropic");
    const run = vi.fn(async ({ provider }: { provider: string }) => {
      if (provider === "anthropic") throw new Error("Not logged in");
      return { text: "OK" };
    });

    await expect(
      verifiedLocalSubscriptionProviders(["openai", "anthropic"], run)
    ).resolves.toEqual(["openai"]);
    expect(run).toHaveBeenCalledWith({
      provider: "openai",
      prompt: "Reply with exactly OK.",
    });
    expect(run).toHaveBeenCalledWith({
      provider: "anthropic",
      prompt: "Reply with exactly OK.",
    });
  });

  /**
   * A Member who signs in from their terminal after the dev server started must
   * not have to restart it: the refusal is cached briefly, the success long.
   */
  it("re-probes a refused provider after its short TTL, and caches a ready one", async () => {
    clearLocalSubscriptionReadinessProbe("openai");
    clearLocalSubscriptionReadinessProbe("anthropic");
    let loggedIn = false;
    const run = vi.fn(async () => {
      if (!loggedIn) throw new Error("Not logged in");
      return { text: "OK" };
    });
    const start = 1_000_000;

    await expect(
      verifiedLocalSubscriptionProviders(["anthropic"], run, start)
    ).resolves.toEqual([]);
    // Same second: the refusal is reused, no second CLI call.
    await expect(
      verifiedLocalSubscriptionProviders(["anthropic"], run, start + 1_000)
    ).resolves.toEqual([]);
    expect(run).toHaveBeenCalledTimes(1);

    loggedIn = true; // `claude auth login --claudeai` in the terminal
    await expect(
      verifiedLocalSubscriptionProviders(["anthropic"], run, start + 30_000)
    ).resolves.toEqual(["anthropic"]);
    expect(run).toHaveBeenCalledTimes(2);

    // A ready verdict then stands for minutes rather than re-probing per turn.
    await expect(
      verifiedLocalSubscriptionProviders(["anthropic"], run, start + 90_000)
    ).resolves.toEqual(["anthropic"]);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("uses the authenticated provider CLI for structured model output", async () => {
    const run = vi.fn(async () => ({
      text: JSON.stringify({ matchingFlowIds: ["flow-admissions"] }),
      inputTokens: 21,
      outputTokens: 7,
    }));
    const model = createLocalSubscriptionModel({
      provider: "anthropic",
      modelId: "claude-sonnet-5",
      run,
    });

    const { object, usage } = await generateObject({
      model,
      schema: z.object({ matchingFlowIds: z.array(z.string()) }),
      prompt: "Choose the matching flow.",
    });

    expect(object).toEqual({ matchingFlowIds: ["flow-admissions"] });
    expect(usage).toMatchObject({ inputTokens: 21, outputTokens: 7 });
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "anthropic",
        modelId: "claude-sonnet-5",
        responseSchema: expect.objectContaining({ type: "object" }),
      })
    );
  });

  it("keeps Ciele tools in the AI SDK loop while the CLI supplies model decisions", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({
        text: JSON.stringify({
          kind: "tool_call",
          toolName: "searchKnowledge",
          input: { query: "tuition fees" },
        }),
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          kind: "text",
          text: "The tuition fee is listed in the admissions guide.",
        }),
      });
    const search = vi.fn(async (query: string) => ({ query, fee: "€12,000" }));
    const model = createLocalSubscriptionModel({
      provider: "openai",
      modelId: "gpt-5.4",
      run,
    });

    const result = streamText({
      model,
      prompt: "How much is tuition?",
      tools: {
        searchKnowledge: tool({
          description: "Search the Ciele Knowledge Collection",
          inputSchema: z.object({ query: z.string() }),
          execute: ({ query }) => search(query),
        }),
      },
      stopWhen: stepCountIs(2),
    });

    expect(await result.text).toBe(
      "The tuition fee is listed in the admissions guide."
    );
    expect(search).toHaveBeenCalledWith("tuition fees");
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[0]?.[0]).toMatchObject({
      provider: "openai",
      responseSchema: expect.objectContaining({
        type: "object",
        properties: expect.objectContaining({ kind: expect.any(Object) }),
      }),
    });
    // OpenAI structured output (Codex) rejects oneOf, the tool-call envelope
    // must offer the tool inputs via anyOf.
    const schema = run.mock.calls[0]?.[0]?.responseSchema as {
      properties: { input: Record<string, unknown> };
    };
    expect(schema.properties.input).toHaveProperty("anyOf");
    expect(schema.properties.input).not.toHaveProperty("oneOf");
  });

  it("accepts Claude natural text after a successful Ciele tool result", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({
        text: JSON.stringify({
          kind: "tool_call",
          text: null,
          toolName: "searchKnowledge",
          input: { query: "numero di lavori realizzati da Alex" },
        }),
      })
      .mockResolvedValueOnce({
        text: "Nel sito di Alex risultano quattro lavori.",
      });
    const search = vi.fn(async () => ({ results: [{ title: "Recent work" }] }));
    const model = createLocalSubscriptionModel({
      provider: "anthropic",
      modelId: "opus",
      run,
    });

    const result = streamText({
      model,
      prompt: "Quanti lavori ha fatto Alex?",
      tools: {
        searchKnowledge: tool({
          inputSchema: z.object({ query: z.string() }),
          execute: search,
        }),
      },
      stopWhen: stepCountIs(2),
    });

    await expect(result.text).resolves.toBe(
      "Nel sito di Alex risultano quattro lavori."
    );
    expect(search).toHaveBeenCalledOnce();
  });

  it("hardens the Codex --output-schema so nested tool inputs pass OpenAI strict validation", async () => {
    // OpenAI structured output (Codex) rejects any object node missing
    // `additionalProperties: false` with invalid_json_schema (400). The
    // search_knowledge tool envelope embeds each tool's raw inputSchema, so
    // without hardening the whole turn fails. Capture the schema Codex is
    // handed (written to the --output-schema file, deleted after the run) and
    // assert every nested object is strict.
    const { readFile } = await import("node:fs/promises");
    let writtenSchema: Record<string, unknown> | null = null;
    const execute = vi.fn(async ({ args }: { args: string[] }) => {
      const schemaPath = args[args.indexOf("--output-schema") + 1];
      writtenSchema = JSON.parse(await readFile(schemaPath, "utf8"));
      return {
        code: 0,
        stdout: [
          JSON.stringify({
            type: "item.completed",
            item: {
              type: "agent_message",
              text: JSON.stringify({
                kind: "text",
                text: "done",
                toolName: null,
                input: null,
              }),
            },
          }),
          JSON.stringify({ type: "turn.completed", usage: {} }),
        ].join("\n"),
        stderr: "",
      };
    });
    const model = createLocalSubscriptionModel({
      provider: "openai",
      modelId: "gpt-5.6-luna",
      run: createLocalCliRunner(execute),
    });

    const result = streamText({
      model,
      prompt: "How many projects?",
      tools: {
        searchKnowledge: tool({
          description: "Search knowledge",
          inputSchema: z.object({ query: z.string() }),
          execute: ({ query }) => ({ query }),
        }),
      },
      stopWhen: stepCountIs(1),
    });
    await result.consumeStream();

    expect(writtenSchema).not.toBeNull();
    const inputBranch = (
      writtenSchema as unknown as {
        properties: { input: { anyOf: Array<Record<string, unknown>> } };
      }
    ).properties.input.anyOf.find((b) => b.type === "object");
    expect(inputBranch).toMatchObject({
      additionalProperties: false,
      required: ["query"],
    });
  });

  it("runs Claude non-interactively with the authenticated subscription", async () => {
    const execute = vi.fn(async () => ({
      code: 0,
      stdout: JSON.stringify({
        type: "result",
        subtype: "success",
        result: JSON.stringify({ answer: "from Claude" }),
        usage: { input_tokens: 13, output_tokens: 4 },
      }),
      stderr: "",
    }));
    const model = createLocalSubscriptionModel({
      provider: "anthropic",
      modelId: "claude-sonnet-5",
      run: createLocalCliRunner(execute),
    });

    const { object, usage } = await generateObject({
      model,
      schema: z.object({ answer: z.string() }),
      prompt: "Answer through the local subscription.",
    });

    expect(object).toEqual({ answer: "from Claude" });
    expect(usage).toMatchObject({ inputTokens: 13, outputTokens: 4 });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "claude",
        args: expect.arrayContaining([
          "--print",
          "--output-format",
          "json",
          "--model",
          "claude-sonnet-5",
          "--json-schema",
        ]),
        stdin: expect.stringContaining("Answer through the local subscription."),
      })
    );
  });

  it("uses Claude structured_output as the schema-constrained response", async () => {
    const execute = vi.fn(async () => ({
      code: 0,
      stdout: JSON.stringify({
        type: "result",
        subtype: "success",
        result: "Nel sito di Alex risultano quattro lavori.",
        structured_output: { answer: "quattro" },
        usage: { input_tokens: 13, output_tokens: 4 },
      }),
      stderr: "",
    }));
    const model = createLocalSubscriptionModel({
      provider: "anthropic",
      modelId: "opus",
      run: createLocalCliRunner(execute),
    });

    const { object } = await generateObject({
      model,
      schema: z.object({ answer: z.string() }),
      prompt: "Answer through Claude.",
    });

    expect(object).toEqual({ answer: "quattro" });
  });

  it("does not mistake Claude's successful process envelope for successful inference", async () => {
    const execute = vi.fn(async () => ({
      code: 0,
      stdout: JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: true,
        result: "Not logged in · Please run /login",
        usage: { input_tokens: 0, output_tokens: 0 },
      }),
      stderr: "",
    }));
    const model = createLocalSubscriptionModel({
      provider: "anthropic",
      modelId: "claude-sonnet-5",
      run: createLocalCliRunner(execute),
    });

    await expect(
      generateObject({
        model,
        schema: z.object({ answer: z.string() }),
        prompt: "Answer through Claude.",
        maxRetries: 0,
      })
    ).rejects.toThrow("Not logged in");
  });

  it("runs Codex non-interactively with the authenticated ChatGPT account", async () => {
    const execute = vi.fn(async () => ({
      code: 0,
      stdout: [
        JSON.stringify({ type: "thread.started", thread_id: "thread-1" }),
        JSON.stringify({
          type: "item.completed",
          item: {
            type: "agent_message",
            text: JSON.stringify({ answer: "from Codex" }),
          },
        }),
        JSON.stringify({
          type: "turn.completed",
          usage: { input_tokens: 17, output_tokens: 5 },
        }),
      ].join("\n"),
      stderr: "",
    }));
    const model = createLocalSubscriptionModel({
      provider: "openai",
      modelId: "gpt-5.4",
      run: createLocalCliRunner(execute),
    });

    const { object, usage } = await generateObject({
      model,
      schema: z.object({ answer: z.string() }),
      prompt: "Answer through the local ChatGPT subscription.",
    });

    expect(object).toEqual({ answer: "from Codex" });
    expect(usage).toMatchObject({ inputTokens: 17, outputTokens: 5 });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "codex",
        args: expect.arrayContaining([
          "exec",
          "--json",
          "--ephemeral",
          "--model",
          "gpt-5.4",
          "--output-schema",
        ]),
        stdin: expect.stringContaining("ChatGPT subscription"),
      })
    );
  });
});
