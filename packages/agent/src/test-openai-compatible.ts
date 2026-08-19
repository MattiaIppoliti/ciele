import { embed, generateText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

/**
 * "Test connection" for an OpenAI-compatible endpoint (#436): one-token chat
 * call, plus one embedding call when an embedding model is configured. Never
 * throws, the admin form renders each leg's outcome; a chat-only endpoint is
 * a valid configuration (knowledge search degrades to lexical).
 */
export interface OpenAiCompatibleTestInput {
  baseUrl: string;
  /** Optional, many local/self-hosted servers ignore authentication. */
  apiKey?: string | null;
  chatModel: string;
  embeddingModel?: string | null;
}

export interface OpenAiCompatibleTestResult {
  chat: { ok: boolean; detail: string | null };
  /** Null when no embedding model is configured (nothing to test). */
  embedding: { ok: boolean; detail: string | null; dims: number | null } | null;
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}

export async function testOpenAiCompatibleConnection(
  input: OpenAiCompatibleTestInput
): Promise<OpenAiCompatibleTestResult> {
  const endpoint = createOpenAICompatible({
    name: "openai-compatible",
    baseURL: input.baseUrl,
    apiKey: input.apiKey ?? undefined,
  });

  let chat: OpenAiCompatibleTestResult["chat"];
  try {
    await generateText({
      model: endpoint.chatModel(input.chatModel),
      prompt: "ping",
      maxOutputTokens: 1,
      abortSignal: AbortSignal.timeout(15_000),
    });
    chat = { ok: true, detail: null };
  } catch (error) {
    chat = { ok: false, detail: errorDetail(error) };
  }

  let embedding: OpenAiCompatibleTestResult["embedding"] = null;
  if (input.embeddingModel) {
    try {
      const result = await embed({
        model: endpoint.textEmbeddingModel(input.embeddingModel),
        value: "ping",
        abortSignal: AbortSignal.timeout(15_000),
      });
      embedding = { ok: true, detail: null, dims: result.embedding.length };
    } catch (error) {
      embedding = { ok: false, detail: errorDetail(error), dims: null };
    }
  }

  return { chat, embedding };
}
