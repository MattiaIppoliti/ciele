import { describe, expect, it } from "vitest";
import {
  EVALUATION_RUN_STALE_MS,
  gradeEvaluation,
  settleStaleEvaluationRun,
  type EvaluationRun,
} from "./evaluation";

const output = {
  answer: "Orders ship within 3 business days.",
  flowId: "shipping",
  flowName: "Shipping",
  sourceUrls: ["https://example.org/shipping"],
  error: null,
};

describe("evaluation reference grading", () => {
  it("marks an unlabelled example as ungraded, not wrong", () => {
    expect(gradeEvaluation("answer", {}, output)).toBeNull();
  });
  it("checks answer, flow and source requirements together", () => {
    const reference = {
      answer_contains: ["3 business days"],
      flow_id: "shipping",
      source_url_contains: ["/shipping"],
    };
    expect(gradeEvaluation("answer", reference, output)).toBe(true);
    expect(
      gradeEvaluation("answer", { ...reference, flow_id: "helpdesk" }, output),
    ).toBe(false);
  });
  it("uses only stage-relevant references", () => {
    const reference = {
      flow_id: "shipping",
      answer_contains: ["never present"],
      source_url_contains: ["never present"],
    };
    expect(gradeEvaluation("classifier", reference, output)).toBe(true);
    expect(gradeEvaluation("reranker", reference, output)).toBe(false);
  });
  it("keeps technical failures in error rate, not in unlabelled accuracy", () => {
    expect(
      gradeEvaluation("preflight", {}, { ...output, error: "timeout" }),
    ).toBeNull();
    expect(
      gradeEvaluation(
        "preflight",
        { flow_id: "shipping" },
        { ...output, error: "timeout" },
      ),
    ).toBe(false);
  });
});

describe("a run whose function stopped", () => {
  const updatedAt = "2026-09-28T10:00:00.000Z";
  const run = {
    id: "run-1",
    status: "running",
    error: null,
    updatedAt,
  } as EvaluationRun;
  const at = (ms: number) => new Date(Date.parse(updatedAt) + ms);

  it("stays running while the runner can still be writing", () => {
    expect(settleStaleEvaluationRun(run, at(EVALUATION_RUN_STALE_MS))).toBe(run);
  });

  it("reads as failed once no runner can still be alive", () => {
    const settled = settleStaleEvaluationRun(run, at(EVALUATION_RUN_STALE_MS + 1));
    expect(settled.status).toBe("failed");
    expect(settled.error).toMatch(/stopped before it finished/);
  });

  it("leaves a finished run alone however old it is", () => {
    const done = { ...run, status: "completed" } as EvaluationRun;
    expect(settleStaleEvaluationRun(done, at(10 * EVALUATION_RUN_STALE_MS))).toBe(done);
  });
});
