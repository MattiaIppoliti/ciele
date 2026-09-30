import { z } from "zod";
import {
  EVALUATION_STAGES,
  modelSelector,
  type EvaluationResult,
} from "@agent-hub/core";
import { OperationError, defineOperation } from "./operation";

/**
 * Eval (#992): Organization-scoped datasets and synthetic runs that compare two
 * or three models on one stage of an Assistant's turn over the same questions.
 *
 * The operation owns the rules a run must satisfy (both rows are the caller's
 * Organization's, the execution cap, every candidate allowed for the stage),
 * and the runtime half, which needs model clients this package does not hold,
 * rides the `evaluation` port.
 */

/** Candidate-by-example executions one synchronous run may perform. */
export const EVALUATION_RUN_CAP = 24;

const reference = z
  .object({
    answer_contains: z.array(z.string().trim().min(1)).max(10).optional(),
    flow_id: z.string().min(1).optional(),
    flow_name: z.string().trim().min(1).max(120).optional(),
    source_url_contains: z.array(z.string().trim().min(1)).max(10).optional(),
  })
  .strict();

export const evaluationExampleSchema = z
  .object({
    id: z.string().trim().min(1).max(80),
    inputs: z
      .object({
        question: z.string().trim().min(1).max(4000),
        launch_url: z.url().optional(),
        history: z
          .array(
            z
              .object({
                role: z.enum(["user", "assistant"]),
                text: z.string().max(4000),
              })
              .strict(),
          )
          .max(10)
          .optional(),
        memory: z.array(z.string().trim().min(1).max(500)).max(20).optional(),
      })
      .strict(),
    reference_outputs: reference.default({}),
  })
  .strict();

export const evaluationDatasetSchema = z.object({
  name: z.string().trim().min(1).max(120),
  examples: z
    .array(evaluationExampleSchema)
    .min(1)
    .max(50)
    .refine(
      (examples) =>
        new Set(examples.map((example) => example.id)).size === examples.length,
      "Example IDs must be unique.",
    ),
});

export const evaluationRunSchema = z.object({
  assistantId: z.string().min(1),
  datasetId: z.string().min(1),
  stage: z.enum(EVALUATION_STAGES),
  candidates: z
    .array(
      z.object({
        provider: z.enum([
          "anthropic",
          "openai",
          "google",
          "openai_compatible",
          "typesafe",
          "voyage",
        ]),
        modelId: z.string().trim().min(1).max(100),
      }),
    )
    .min(2)
    .max(3)
    .refine(
      (candidates) =>
        new Set(candidates.map(modelSelector)).size === candidates.length,
      "Choose distinct models.",
    ),
});

export const createEvaluationDatasetOp = defineOperation({
  name: "eval.datasets.create",
  capability: "edit",
  effect: "write",
  input: evaluationDatasetSchema,
  entities: () => [{ kind: "evaluations" }],
  async run(ctx, input) {
    const dataset = await ctx.db.table("evaluationDatasets").insert({
      organizationId: ctx.organizationId,
      ...input,
    });
    return { id: dataset.id };
  },
});

export const startEvaluationRunOp = defineOperation({
  name: "eval.runs.start",
  capability: "edit",
  effect: "consequential",
  input: evaluationRunSchema,
  entities: () => [{ kind: "evaluations" }],
  async run(ctx, { assistantId, datasetId, stage, candidates }) {
    const [assistant, dataset] = await Promise.all([
      ctx.db.getAssistant(assistantId),
      ctx.db.table("evaluationDatasets").get(datasetId),
    ]);
    if (
      !assistant ||
      assistant.organizationId !== ctx.organizationId ||
      !dataset ||
      dataset.organizationId !== ctx.organizationId
    ) {
      throw new OperationError("not_found", "Assistant or dataset not found.");
    }
    if (dataset.examples.length * candidates.length > EVALUATION_RUN_CAP) {
      throw new OperationError(
        "invalid_input",
        `A run supports up to ${EVALUATION_RUN_CAP} evaluations (examples × models). Reduce the dataset or model count.`,
      );
    }
    const runner = ctx.ports?.evaluation;
    if (!runner)
      throw new OperationError(
        "invalid_input",
        "Evaluations are not available on this surface.",
      );
    const prepared = await runner.prepare({ assistant, stage });
    const allowed = new Set(prepared.allowedCandidates.map(modelSelector));
    if (candidates.some((candidate) => !allowed.has(modelSelector(candidate))))
      throw new OperationError(
        "invalid_input",
        "Select models available for this stage and the organization’s provider connections.",
      );

    const runs = ctx.db.table("evaluationRuns");
    const run = await runs.insert({
      organizationId: ctx.organizationId,
      assistantId,
      assistantName: assistant.title,
      assistantModel: {
        provider: assistant.modelProvider,
        modelId: assistant.modelId,
      },
      datasetId,
      datasetName: dataset.name,
      examples: dataset.examples,
      stage,
      candidates,
    });
    const results: EvaluationResult[] = [];
    let status: "completed" | "failed" = "completed";
    let error: string | null = null;
    try {
      for (const example of dataset.examples) {
        const batch = await Promise.all(
          candidates.map((candidate) => prepared.runCase(example, candidate)),
        );
        results.push(...batch);
        await runs.update(run.id, { results });
      }
      if (results.every((result) => result.error)) {
        status = "failed";
        error = "All evaluations failed. Check your credentials and selected models.";
      }
    } catch (caught) {
      status = "failed";
      error = caught instanceof Error ? caught.message : "Unknown error";
    }
    await runs.update(run.id, { status, results, error });
    return { id: run.id, status, error };
  },
});
