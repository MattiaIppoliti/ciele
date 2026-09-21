import { describe, expect, it } from "vitest";
import { failureCountOf } from "./goal-improvement";
import { buildPublicationConfig } from "@agent-hub/core";
import { getMockDb, DEMO_ORG } from "@agent-hub/db";
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

    const [updated] = (await db.table("assistantGoals").list({ assistantId: assistant.id })).filter(
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
    const [failed] = (await db.table("assistantGoals").list({ assistantId: assistant.id })).filter(
      (g) => g.id === goal.id
    );
    expect(failed.lastResult).toBe("fail");
    expect(failed.lastDetail).toContain("refund window");
    expect(await activeGoalAlerts(goal.id)).toHaveLength(1);

    // Fix the expectation → next due run passes → the Alert auto-resolves.
    await db.table("assistantGoals").update(goal.id, {
      expectations: { mustContain: ["free"] },
    });
    await runDueGoalEvals({ db, }, { dueBefore: new Date(Date.now() + 60_000).toISOString() });
    expect(await activeGoalAlerts(goal.id)).toHaveLength(0);
  });

  it("files an Improvement the same night, beside the Alert (#903)", async () => {
    // The Alert says an operator should look. The Improvement is where the fix
    // gets drafted, reviewed and accepted into the Assistant's knowledge, and
    // it used to wait up to 6.5 days for the compost digest to notice.
    const assistant = await publishedAssistant();
    const goal = await db.createAssistantGoal(assistant.id, {
      question: "What does shipping cost?",
      expectations: { mustContain: ["refund window"] },
    });

    await runDueGoalEvals({ db });

    expect(await activeGoalAlerts(goal.id)).toHaveLength(1);
    const improvements = await db.listImprovements(DEMO_ORG.id);
    const filed = improvements.filter((i) => i.tags.includes(`goal:${goal.id}`));
    expect(filed).toHaveLength(1);
    expect(filed[0]!.title).toContain("Standing goal failing");
    expect(filed[0]!.description).toContain("What does shipping cost?");
    expect(filed[0]!.description).toContain("refund window");
    // The answer the eval actually produced, which is the piece that had to be
    // threaded out of `executeGoal`. Asserted against the published
    // Assistant's own reply text: the question and the grade detail both reach
    // the description by other routes, so checking those would pass with the
    // threading removed.
    const answered = await db.listPublications(assistant.id);
    expect(answered.length).toBeGreaterThan(0);
    expect(filed[0]!.description).toContain("**What the Assistant answered**");
    expect(filed[0]!.description).not.toContain(
      "(the Assistant produced no answer text)"
    );

    // And the Suggested Fix is queued rather than written.
    // Scoped to this goal: the drain runs every due goal cross-org, and the
    // demo seed has its own.
    const mine = (
      await db.claimBackgroundJobs({
        kind: "draft_goal_proposal",
        limit: 20,
        workerId: "test",
        now: new Date().toISOString(),
        staleBefore: new Date(Date.now() - 3_600_000).toISOString(),
      })
    ).filter((job) => (job.payload as { improvementId?: string }).improvementId === filed[0]!.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.payload).toMatchObject({
      assistantId: assistant.id,
      question: "What does shipping cost?",
    });
    expect(await db.getImprovementProposal(filed[0]!.id)).toBeNull();
  });

  it("stops at one card however many nights a goal keeps failing", async () => {
    const assistant = await publishedAssistant();
    const goal = await db.createAssistantGoal(assistant.id, {
      question: "What does shipping cost?",
      expectations: { mustContain: ["refund window"] },
    });
    for (let night = 0; night < 3; night += 1) {
      // A `dueBefore` in the future makes every goal due again, which is how
      // three nights are simulated without touching the claim lease.
      await runDueGoalEvals(
        { db },
        { dueBefore: new Date(Date.now() + 60_000).toISOString() }
      );
    }
    const filed = (await db.listImprovements(DEMO_ORG.id)).filter((i) =>
      i.tags.includes(`goal:${goal.id}`)
    );
    expect(filed).toHaveLength(1);
    // The count lives on a tag, not in the title: the title is the
    // reviewer's from the moment the card is filed.
    expect(failureCountOf(filed[0]!)).toBe(3);
    // One draft, from the first night. A goal that fails again tomorrow
    // failed the same way, so a second draft would cost a model call to say
    // the same thing.
    const mine = (
      await db.claimBackgroundJobs({
        kind: "draft_goal_proposal",
        limit: 20,
        workerId: "test",
        now: new Date().toISOString(),
        staleBefore: new Date(Date.now() - 3_600_000).toISOString(),
      })
    ).filter((job) => (job.payload as { improvementId?: string }).improvementId === filed[0]!.id);
    expect(mine).toHaveLength(1);
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
    const [updated] = (await db.table("assistantGoals").list({ assistantId: assistant.id })).filter(
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
    await db.table("assistantGoals").update(parked.id, { status: "quarantined" });

    await runDueGoalEvals({ db });
    const goals = await db.table("assistantGoals").list({ assistantId: assistant.id });
    expect(goals.find((g) => g.id === fresh.id)?.lastResult).toBe("pass");
    expect(goals.find((g) => g.id === parked.id)?.lastResult).toBeNull();

    // Everything already ran within the window: nothing is due.
    const second = await runDueGoalEvals({ db });
    expect(second.processed).toBe(0);
  });
});
