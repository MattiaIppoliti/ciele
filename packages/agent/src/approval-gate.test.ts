import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Experimental_EvaluationMockModelV4 } from "ai/test";
import { APPROVAL_GATE_THRESHOLDS } from "@agent-hub/core";
import { approvalCardPart, runApprovalGate } from "./approval-gate";
import { registerRuntimeHost, resetRuntimeHost } from "./host";
import type { ResolvedDecisionModel } from "./decision-model";
import type { UsageEvent } from "./types";

/**
 * The gate's call. What it decides is `approvalVerdict`'s job and is tested in
 * core; what is tested here is that every way the call can go wrong ends on
 * the safe answer, and that a safe answer costs nothing it should not.
 */

beforeEach(() => {
  // Off by default (#958), so every test that expects a verdict says so.
  registerRuntimeHost({ approvalGateEnabled: () => true });
});
afterEach(() => {
  resetRuntimeHost();
});

const subject = {
  label: "Create an Improvement",
  description: "Files a new item on the Improvements board.",
  arguments: '{"title":"Password reset page is wrong"}',
  roleDescription: "Watches feedback and files what needs fixing.",
};

type MockEvaluate = NonNullable<
  NonNullable<ConstructorParameters<typeof Experimental_EvaluationMockModelV4>[0]>["doEvaluate"]
>;

function resolvedWith(doEvaluate: MockEvaluate): ResolvedDecisionModel {
  return {
    model: new Experimental_EvaluationMockModelV4({ modelId: "jev-1.13.0", doEvaluate }),
    backend: "jev",
    provider: "typesafe",
    modelId: "typesafe-ai/jev",
    credentialKind: "platform",
    calibrated: true,
  };
}

function answering(reversibility: string, confidence: number, outOfMandate = 0.02) {
  return resolvedWith(async ({ questions }: Parameters<MockEvaluate>[0]) => {
    const options =
      questions.reversibility && questions.reversibility.type === "choice"
        ? Object.keys(questions.reversibility.criteria)
        : [];
    return {
      answers: {
        reversibility: {
          type: "choice",
          choice: reversibility,
          probabilities: Object.fromEntries(
            options.map((option) => [option, option === reversibility ? 1 : 0])
          ),
        },
        out_of_mandate: { type: "boolean", probability: outOfMandate },
      },
      rounding: { probabilityDecimals: 2, scoreDecimals: 2 },
      usage: { inputTokens: 220, outputTokens: 12 },
      providerMetadata: {
        typesafe: { confidence: { reversibility: confidence, out_of_mandate: confidence } },
      },
      warnings: [],
    };
  });
}

describe("runApprovalGate", () => {
  it("lets a confidently read-only action through, and meters the call", async () => {
    const usage: UsageEvent[] = [];
    const result = await runApprovalGate({
      subject,
      resolved: answering("read_only", 0.97),
      recordUsage: (event) => usage.push(event),
    });
    expect(result.verdict).toEqual({ kind: "allow", reversibility: "read_only" });
    expect(result.backend).toBe("jev");
    expect(usage.map((event) => event.stage)).toEqual(["decide"]);
  });

  it("asks a human about an irreversible action", async () => {
    const result = await runApprovalGate({
      subject,
      resolved: answering("irreversible", 0.99),
    });
    expect(result.verdict).toEqual({
      kind: "review",
      reversibility: "irreversible",
      reason: "irreversible",
    });
  });

  it("asks a human when it is not sure enough", async () => {
    const result = await runApprovalGate({
      subject,
      resolved: answering("read_only", APPROVAL_GATE_THRESHOLDS.reversibility - 0.05),
    });
    expect(result.verdict.kind).toBe("review");
  });

  it("asks a human when there is no decision backend, and bills nothing", async () => {
    const usage: UsageEvent[] = [];
    const result = await runApprovalGate({
      subject,
      resolved: null,
      recordUsage: (event) => usage.push(event),
    });
    // The whole point of failing this way: no key must not mean no gate.
    expect(result.verdict).toEqual({ kind: "review", reversibility: null, reason: "no_decision" });
    expect(usage).toEqual([]);
  });

  it("asks a human when the backend throws", async () => {
    const result = await runApprovalGate({
      subject,
      resolved: resolvedWith(async () => {
        throw new Error("gateway said no");
      }),
    });
    expect(result.verdict.kind).toBe("review");
  });

  it("asks a human when the backend never answers, within the budget", async () => {
    // An outage must not become an approval, and must not become a hang either.
    const result = await runApprovalGate({
      subject,
      resolved: resolvedWith(() => new Promise(() => {})),
      timeoutMs: 20,
    });
    expect(result.verdict.kind === "review" && result.verdict.reason).toBe("no_decision");
  });
});

describe("approvalCardPart", () => {
  it("carries the catalogue's words and the reason, and never the arguments", () => {
    const part = approvalCardPart({
      approvalId: "app_1",
      label: "Create an Improvement",
      verdict: { kind: "review", reversibility: "irreversible", reason: "irreversible" },
    });
    const rendered = JSON.stringify(part);
    expect(part).toMatchObject({
      type: "action_approval",
      approvalId: "app_1",
      label: "Create an Improvement",
      reason: "irreversible",
    });
    // The card is read by somebody with the authority to say yes, so nothing
    // the caller supplied as arguments may reach it.
    expect(rendered).not.toContain("Password reset page is wrong");
  });
});

/**
 * The distinction the whole feature's "optional by construction" rests on.
 *
 * A deployment that never had a decision key has not opted into the gate and
 * must run exactly as it did before. A key that stopped working is an outage,
 * and an outage must not become an approval. Both used to come back as the
 * same unjudged result, which would have stopped every gated action on every
 * self-host the moment this shipped.
 */
describe("no backend configured, against a backend that failed", () => {
  it("says no gate is configured when nothing resolves", async () => {
    const result = await runApprovalGate({ subject, resolved: null });
    expect(result.backend).toBeNull();
  });

  it("names the backend when one was configured and then failed", async () => {
    const result = await runApprovalGate({
      subject,
      resolved: resolvedWith(async () => {
        throw new Error("gateway said no");
      }),
    });
    expect(result.backend).toBe("jev");
    expect(result.verdict.kind).toBe("review");
  });

  it("names the backend when one was configured and then hung", async () => {
    const result = await runApprovalGate({
      subject,
      resolved: resolvedWith(() => new Promise(() => {})),
      timeoutMs: 20,
    });
    expect(result.backend).toBe("jev");
    expect(result.verdict.kind).toBe("review");
  });
});

describe("the gate's own switch", () => {
  it("is off unless the host turns it on, whatever keys exist", async () => {
    // The mistake this fixes: the gate used to wake up the moment a decision
    // key was in the environment, so setting one for the shadow pre-flight
    // would have started halting `api_request` on live Visitor traffic. A key
    // is a credential, not a decision to change behaviour.
    resetRuntimeHost();
    const result = await runApprovalGate({
      subject,
      resolved: answering("irreversible", 0.99),
    });
    // Reads to every caller exactly like "no backend", which is the path they
    // already take: proceed as before.
    expect(result.backend).toBeNull();
  });
});
