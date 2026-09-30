import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getMockDb } from "@agent-hub/db";
import type { ChatModelOption } from "@agent-hub/agent/client";
import { resolveAutoModel } from "./auto-model";

/**
 * "Auto" over the Db the demo runs on: an Eval ranks, the chat asks the winner
 * it can reach, and with no Eval it asks the configured model.
 */

const option = (provider: "anthropic" | "openai", modelId: string, label: string): ChatModelOption => ({
  selector: `${provider}:${modelId}`,
  provider,
  modelId,
  label,
  providerName: provider,
});
const opus = option("anthropic", "claude-opus-4-8", "Claude Opus 4.8");
const gpt = option("openai", "gpt-5.1", "GPT-5.1");

describe("resolveAutoModel", () => {
  it("asks the configured model when no Eval has ranked one", async () => {
    const org = `org-${randomUUID()}`;
    expect(await resolveAutoModel(getMockDb(), org, [opus, gpt])).toBeNull();
  });

  it("asks the latest answer Eval's winner among the askable models", async () => {
    const db = getMockDb();
    const org = `org-${randomUUID()}`;
    const candidate = (o: ChatModelOption) => ({ provider: o.provider, modelId: o.modelId });
    const run = await db.table("evaluationRuns").insert({
      organizationId: org,
      assistantId: "a",
      assistantName: "A",
      assistantModel: candidate(opus),
      datasetId: "d",
      datasetName: "D",
      examples: [{ id: "e1", inputs: { question: "q" }, reference_outputs: {} }],
      stage: "answer",
      candidates: [candidate(opus), candidate(gpt)],
    });
    const result = (o: ChatModelOption, accuracy: boolean) => ({
      exampleId: "e1",
      candidate: candidate(o),
      answer: "",
      flowId: null,
      flowName: null,
      sourceUrls: [],
      latencyMs: 10,
      inputTokens: 1,
      outputTokens: 1,
      costEur: 0,
      accuracy,
      autonomous: null,
      error: null,
    });
    await db.table("evaluationRuns").update(run.id, {
      status: "completed",
      results: [result(opus, false), result(gpt, true)],
    });

    const pick = await resolveAutoModel(db, org, [opus, gpt]);
    expect(pick?.selector).toBe(gpt.selector);
    // Not askable now (no connection): the next one down.
    expect((await resolveAutoModel(db, org, [opus, { ...gpt, unavailable: true }]))?.selector).toBe(
      opus.selector
    );
  });
});
