import { wrapLanguageModel, type LanguageModel } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { piiMaskingMiddleware } from "../pii-masking";

/**
 * Test-only. A fake model behind the PII masking middleware, which is what
 * `buildModel` hands every caller in production; a job's test seam takes a
 * bare model, so a test of the job's masking has to put the middleware back.
 * Every prompt it is sent lands in `seen`, as JSON, and it answers `reply`.
 */
export function maskedModel(seen: string[], reply: string): LanguageModel {
  return wrapLanguageModel({
    model: new MockLanguageModelV3({
      doGenerate: async (options: { prompt: unknown }) => {
        seen.push(JSON.stringify(options.prompt));
        return {
          content: [{ type: "text" as const, text: reply }],
          finishReason: { unified: "stop" as const, raw: "stop" },
          usage: {
            inputTokens: { total: 8, noCache: 8, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 4, text: 4, reasoning: undefined },
          },
          warnings: [],
        };
      },
    }),
    middleware: piiMaskingMiddleware(),
  }) as unknown as LanguageModel;
}
