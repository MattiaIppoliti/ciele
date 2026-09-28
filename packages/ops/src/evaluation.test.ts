import { describe, expect, it } from "vitest";
import type {
  EvaluationCandidate,
  EvaluationExample,
  EvaluationResult,
  Role,
} from "@agent-hub/core";
import { DEMO_MEMBER, DEMO_ORG, getMockDb } from "@agent-hub/db";
import { OperationError, type OperationContext, type OperationPorts } from "./operation";
import {
  EVALUATION_RUN_CAP,
  createEvaluationDatasetOp,
  evaluationDatasetSchema,
  evaluationRunSchema,
  startEvaluationRunOp,
} from "./evaluation";

const example = {
  id: "q1",
  inputs: { question: "When do orders ship?" },
  reference_outputs: { answer_contains: ["3 business days"] },
};

describe("the dataset upload boundary", () => {
  it("accepts the documented dataset format", () => {
    expect(
      evaluationDatasetSchema.safeParse({ name: "Shipping", examples: [example] })
        .success,
    ).toBe(true);
  });
  it("rejects duplicate IDs and unknown input fields", () => {
    expect(
      evaluationDatasetSchema.safeParse({
        name: "Shipping",
        examples: [example, example],
      }).success,
    ).toBe(false);
    expect(
      evaluationDatasetSchema.safeParse({
        name: "Shipping",
        examples: [{ ...example, inputs: { question: "ok", api_key: "secret" } }],
      }).success,
    ).toBe(false);
  });
  it("requires distinct candidates", () => {
    const candidate = { provider: "openai", modelId: "gpt-5.4-mini" };
    expect(
      evaluationRunSchema.safeParse({
        assistantId: "a",
        datasetId: "d",
        stage: "answer",
        candidates: [candidate, candidate],
      }).success,
    ).toBe(false);
  });
});

const openai: EvaluationCandidate = { provider: "openai", modelId: "gpt-5.4-mini" };
const google: EvaluationCandidate = { provider: "google", modelId: "gemini-3.5-flash" };

function resultFor(
  exampleId: string,
  candidate: EvaluationCandidate,
  error: string | null = null,
): EvaluationResult {
  return {
    exampleId,
    candidate,
    answer: "Within 3 business days.",
    flowId: null,
    flowName: null,
    sourceUrls: [],
    latencyMs: 1,
    inputTokens: 1,
    outputTokens: 1,
    costEur: 0,
    accuracy: null,
    autonomous: true,
    error,
  };
}

/** A runner that allows `allowed` and answers every case, or fails it. */
function runner(
  allowed: EvaluationCandidate[],
  error: string | null = null,
): NonNullable<OperationPorts["evaluation"]> & { cases: string[] } {
  const cases: string[] = [];
  return {
    cases,
    prepare: async () => ({
      allowedCandidates: allowed,
      runCase: async (item: EvaluationExample, candidate: EvaluationCandidate) => {
        cases.push(`${item.id}/${candidate.modelId}`);
        return resultFor(item.id, candidate, error);
      },
    }),
  };
}

async function setup(evaluation?: OperationPorts["evaluation"], examples = [example]) {
  const db = getMockDb();
  const ctx: OperationContext = {
    organizationId: DEMO_ORG.id,
    userId: DEMO_MEMBER.userId,
    role: "editor" as Role,
    db,
    ports: evaluation ? { evaluation } : undefined,
  };
  const [assistant] = await db.listAssistants(DEMO_ORG.id);
  const { id: datasetId } = await createEvaluationDatasetOp.run(ctx, {
    name: "Shipping",
    examples,
  });
  return { ctx, db, assistantId: assistant!.id, datasetId };
}

describe("starting a run", () => {
  it("runs every example against every candidate and saves the results", async () => {
    const port = runner([openai, google]);
    const { ctx, db, assistantId, datasetId } = await setup(port);
    const started = await startEvaluationRunOp.run(ctx, {
      assistantId,
      datasetId,
      stage: "answer",
      candidates: [openai, google],
    });
    expect(started.status).toBe("completed");
    expect(port.cases).toEqual(["q1/gpt-5.4-mini", "q1/gemini-3.5-flash"]);
    const run = await db.table("evaluationRuns").get(started.id);
    expect(run?.results).toHaveLength(2);
    expect(run?.status).toBe("completed");
  });

  it("refuses a candidate the stage does not allow, before recording a run", async () => {
    const port = runner([openai]);
    const { ctx, db, assistantId, datasetId } = await setup(port);
    const before = await db.table("evaluationRuns").list({ organizationId: DEMO_ORG.id });
    await expect(
      startEvaluationRunOp.run(ctx, {
        assistantId,
        datasetId,
        stage: "answer",
        candidates: [openai, google],
      }),
    ).rejects.toThrow(/available for this stage/);
    const after = await db.table("evaluationRuns").list({ organizationId: DEMO_ORG.id });
    expect(after).toHaveLength(before.length);
    expect(port.cases).toEqual([]);
  });

  it("refuses more executions than the cap", async () => {
    const examples = Array.from({ length: EVALUATION_RUN_CAP / 2 + 1 }, (_, i) => ({
      ...example,
      id: `q${i}`,
    }));
    const port = runner([openai, google]);
    const { ctx, assistantId, datasetId } = await setup(port, examples);
    await expect(
      startEvaluationRunOp.run(ctx, {
        assistantId,
        datasetId,
        stage: "answer",
        candidates: [openai, google],
      }),
    ).rejects.toThrow(/up to 24 evaluations/);
    expect(port.cases).toEqual([]);
  });

  it("answers not_found for another Organization's dataset", async () => {
    const { ctx, assistantId, datasetId } = await setup(runner([openai, google]));
    const error = await startEvaluationRunOp
      .run(
        { ...ctx, organizationId: "org-somebody-else" },
        { assistantId, datasetId, stage: "answer", candidates: [openai, google] },
      )
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OperationError);
    expect((error as OperationError).code).toBe("not_found");
  });

  it("marks the run failed when every case failed", async () => {
    const { ctx, assistantId, datasetId } = await setup(
      runner([openai, google], "provider unavailable"),
    );
    const started = await startEvaluationRunOp.run(ctx, {
      assistantId,
      datasetId,
      stage: "answer",
      candidates: [openai, google],
    });
    expect(started.status).toBe("failed");
    expect(started.error).toMatch(/All evaluations failed/);
  });

  it("refuses to run on a surface with no evaluation runner", async () => {
    const { ctx, assistantId, datasetId } = await setup();
    await expect(
      startEvaluationRunOp.run(ctx, {
        assistantId,
        datasetId,
        stage: "answer",
        candidates: [openai, google],
      }),
    ).rejects.toThrow(/not available on this surface/);
  });
});
