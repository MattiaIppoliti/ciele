import { describe, expect, it } from "vitest";
import {
  buildPublicationConfig,
  getMockDb,
  DEMO_ORG,
} from "@agent-hub/db";
import { runDueGoalEvals } from "./goal-runner";

/**
 * The goal runner, tested offline through the mock Db: with no provider
 * connections the engine takes the deterministic keyword path, so a
 * custom_message flow gives a real, gradable answer without any model.
 */

const db = getMockDb();

async function publishedAssistant() {
  const assistant = await db.createAssistant(DEMO_ORG.id, {
    title: "Goal Runner Fixture",
  });
  await db.createFlow(assistant.id, {
    name: "Shipping",
    description: "shipping cost questions",
    actions: ["custom_message"],
    customMessage: "Shipping is free for orders over 50.",
  });
  const flows = await db.listFlows(assistant.id);
  await db.createPublication(
    assistant.id,
    buildPublicationConfig(assistant, flows, [])
  );
  return assistant;
}

const activeGoalAlerts = async (goalId: string) =>
  (await db.listAlerts(DEMO_ORG.id)).filter(
    (a) => a.sourceKey === `goal:${goalId}` && a.status === "active"
  );

describe("runDueGoalEvals", () => {
  it("passes a goal the published assistant answers, no conversation persisted", async () => {
    const assistant = await publishedAssistant();
    const goal = await db.createAssistantGoal(assistant.id, {
      question: "What does shipping cost?",
      expectations: { mustContain: ["free"] },
    });

    const result = await runDueGoalEvals({ db });
    expect(result.processed).toBeGreaterThanOrEqual(1);

    const [updated] = (await db.listAssistantGoals(assistant.id)).filter(
      (g) => g.id === goal.id
    );
    expect(updated.lastResult).toBe("pass");
    expect(await activeGoalAlerts(goal.id)).toHaveLength(0);
  });

  it("fails a goal whose expectation breaks and raises an auto-resolving Alert", async () => {
    const assistant = await publishedAssistant();
    const goal = await db.createAssistantGoal(assistant.id, {
      question: "What does shipping cost?",
      expectations: { mustContain: ["refund window"] },
    });

    await runDueGoalEvals({ db });
    const [failed] = (await db.listAssistantGoals(assistant.id)).filter(
      (g) => g.id === goal.id
    );
    expect(failed.lastResult).toBe("fail");
    expect(failed.lastDetail).toContain("refund window");
    expect(await activeGoalAlerts(goal.id)).toHaveLength(1);

    // Fix the expectation → next due run passes → the Alert auto-resolves.
    await db.updateAssistantGoal(goal.id, {
      expectations: { mustContain: ["free"] },
    });
    await runDueGoalEvals({ db, }, { dueBefore: new Date(Date.now() + 60_000).toISOString() });
    expect(await activeGoalAlerts(goal.id)).toHaveLength(0);
  });

  it("fails honestly when the assistant has no Publication", async () => {
    const assistant = await db.createAssistant(DEMO_ORG.id, {
      title: "Unpublished Fixture",
    });
    const goal = await db.createAssistantGoal(assistant.id, {
      question: "Anything?",
      expectations: {},
    });
    await runDueGoalEvals({ db });
    const [updated] = (await db.listAssistantGoals(assistant.id)).filter(
      (g) => g.id === goal.id
    );
    expect(updated.lastResult).toBe("fail");
    expect(updated.lastDetail).toContain("Publication");
  });

  it("does not re-run goals inside the cadence window (lease) and skips quarantined goals", async () => {
    const assistant = await publishedAssistant();
    const fresh = await db.createAssistantGoal(assistant.id, {
      question: "What does shipping cost?",
      expectations: {},
    });
    const parked = await db.createAssistantGoal(assistant.id, {
      question: "Parked question",
      expectations: {},
    });
    await db.updateAssistantGoal(parked.id, { status: "quarantined" });

    await runDueGoalEvals({ db });
    const goals = await db.listAssistantGoals(assistant.id);
    expect(goals.find((g) => g.id === fresh.id)?.lastResult).toBe("pass");
    expect(goals.find((g) => g.id === parked.id)?.lastResult).toBeNull();

    // Everything already ran within the window: nothing is due.
    const second = await runDueGoalEvals({ db });
    expect(second.processed).toBe(0);
  });
});
