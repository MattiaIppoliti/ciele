import { describe, expect, it, vi } from "vitest";
import { Experimental_EvaluationMockModelV4 } from "ai/test";
import { PREFLIGHT_MODEL_ID } from "@agent-hub/core";
import { PREFLIGHT_GOLD_SETS, type PreflightGoldMessage } from "@agent-hub/core/testing";
import type { Db } from "@agent-hub/db";

import type { ResolvedDecisionModel } from "./decision-model";
import { runPreflightDriftReplay } from "./preflight-drift";

/**
 * The drift replay (#953) with a scripted backend: a model that answers the
 * gold for every baseline case clears the Alert, one that moves a baseline
 * case raises it, and a backend that throws is an outage, never drift.
 */

const synthetic = PREFLIGHT_GOLD_SETS.find((s) => s.name === "synthetic")!;
const byId = new Map(synthetic.cases.map((c) => [c.message, c]));

/** Answers every question with the gold label, except where `wrong` names the message. */
function goldModel(wrong: Set<string> = new Set(), options: { throwOn?: Set<string> } = {}): ResolvedDecisionModel {
  return {
    model: new Experimental_EvaluationMockModelV4({
      modelId: PREFLIGHT_MODEL_ID,
      doEvaluate: async ({ state, questions }) => {
        const message = String(state);
        if (options.throwOn?.has(message)) throw new Error("gateway 502");
        const gold = byId.get(message) as PreflightGoldMessage;
        const flip = wrong.has(message);
        const confidence: Record<string, number> = {};
        const choice = (id: string, options: string[], want: string) => {
          const picked = flip && id === "flow" ? options.find((o) => o !== want)! : want;
          confidence[id] = 0.99;
          return { type: "choice" as const, choice: picked, probabilities: Object.fromEntries(options.map((o) => [o, o === picked ? 1 : 0])) };
        };
        return {
          answers: Object.fromEntries(
            Object.entries(questions).map(([id, q]) => {
              if (q.type === "boolean") return [id, { type: "boolean", probability: gold.labels.wantsHuman ? 0.99 : 0.01 }];
              if (q.type === "score") {
                const levels = q.criteria.length;
                confidence[id] = 0.9;
                return [id, { type: "score", score: 0, probabilities: Object.fromEntries(Array.from({ length: levels }, (_, i) => [String(i), i === 0 ? 1 : 0])) }];
              }
              const options = Object.keys(q.criteria);
              const want = id === "flow" ? gold.labels.flow : id === "faq" ? gold.labels.faq : id === "desk" ? gold.labels.desk : gold.labels.language;
              return [id, choice(id, options, want)];
            })
          ),
          rounding: { probabilityDecimals: 2, scoreDecimals: 2 },
          usage: { inputTokens: 300, outputTokens: 20 },
          providerMetadata: { typesafe: { confidence } },
          warnings: [],
        };
      },
    }),
    backend: "jev",
    provider: "typesafe",
    modelId: "typesafe-ai/jev",
    credentialKind: "platform",
    calibrated: true,
  };
}

function fakeDb() {
  const raised: { organizationId: string; title: string; sourceKey: string | null | undefined }[] = [];
  const resolved: { organizationId: string; key: string }[] = [];
  const db = {
    raiseAlert: vi.fn(async (organizationId: string, input: { title: string; sourceKey?: string | null }) => {
      raised.push({ organizationId, title: input.title, sourceKey: input.sourceKey });
      return {} as never;
    }),
    resolveAlertsByKey: vi.fn(async (organizationId: string, key: string) => {
      resolved.push({ organizationId, key });
    }),
  } as unknown as Db;
  return { db, raised, resolved };
}

// A message whose gold destination is a listed Flow: flipping its `flow`
// answer is what moves it. A message that wanted a person would escalate
// whatever the Flow answer said, and would show no drift.
const flowCase = synthetic.cases.find(
  (c) => !c.labels.wantsHuman && c.labels.faq === "none" && c.labels.flow !== "default" && c.labels.flow !== "other"
)!;
const baseline = [flowCase, ...synthetic.cases.filter((c) => c !== flowCase).slice(0, 5)].map((c) => ({
  set: "synthetic" as const,
  id: c.id,
}));

describe("runPreflightDriftReplay", () => {
  it("clears the Alert when every baseline case still routes as labelled", async () => {
    const { db, raised, resolved } = fakeDb();
    const report = await runPreflightDriftReplay({ db, organizationIds: ["org-1"], resolved: goldModel(), baseline });

    expect(report).toMatchObject({ replayed: 6, passed: 6, regressed: [], failed: [], signalled: ["org-1"] });
    expect(raised).toEqual([]);
    expect(resolved).toEqual([{ organizationId: "org-1", key: "preflight-drift" }]);
  });

  it("raises one system Alert per owner Organization when a baseline case moves", async () => {
    const { db, raised } = fakeDb();
    const report = await runPreflightDriftReplay({
      db,
      organizationIds: ["org-1", "org-2"],
      resolved: goldModel(new Set([flowCase.message])),
      baseline,
    });

    expect(report.regressed).toHaveLength(1);
    expect(report.regressed[0]).toMatchObject({ set: "synthetic", id: flowCase.id, gold: { kind: "flow", flowId: flowCase.labels.flow } });
    expect(report.passed).toBe(5);
    expect(raised.map((r) => r.organizationId)).toEqual(["org-1", "org-2"]);
    expect(raised[0].sourceKey).toBe("preflight-drift");
    expect(raised[0].title).toContain("1 labelled case");
  });

  it("counts a backend that threw as a failure, not as drift", async () => {
    const { db, raised, resolved } = fakeDb();
    const broken = baseline[1] && synthetic.cases.find((c) => c.id === baseline[1].id)!;
    const report = await runPreflightDriftReplay({
      db,
      organizationIds: ["org-1"],
      resolved: goldModel(new Set(), { throwOn: new Set([broken.message]) }),
      baseline,
    });

    expect(report.failed).toEqual([{ set: "synthetic", id: broken.id, error: "gateway 502" }]);
    expect(report.regressed).toEqual([]);
    expect(raised).toEqual([]);
    expect(resolved).toHaveLength(1);
  });

  it("runs nothing without a calibrated backend or with an empty baseline", async () => {
    const { db, raised, resolved } = fakeDb();
    expect(await runPreflightDriftReplay({ db, organizationIds: ["org-1"], resolved: null, baseline })).toMatchObject({ skipped: "no_backend", replayed: 0 });
    expect(await runPreflightDriftReplay({ db, organizationIds: ["org-1"], resolved: { ...goldModel(), calibrated: false, backend: "adapter" }, baseline })).toMatchObject({ skipped: "no_backend" });
    expect(await runPreflightDriftReplay({ db, organizationIds: ["org-1"], resolved: goldModel(), baseline: [] })).toMatchObject({ skipped: "empty_baseline" });
    expect(raised).toEqual([]);
    expect(resolved).toEqual([]);
  });

  it("reports a baseline entry the labelled sets no longer contain instead of throwing", async () => {
    const { db } = fakeDb();
    const report = await runPreflightDriftReplay({
      db,
      organizationIds: [],
      resolved: goldModel(),
      baseline: [{ set: "synthetic", id: "syn-999" }],
    });
    expect(report.failed).toEqual([{ set: "synthetic", id: "syn-999", error: "not in the labelled sets" }]);
    expect(report.signalled).toEqual([]);
  });
});
