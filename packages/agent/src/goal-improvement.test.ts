import { beforeEach, describe, expect, it } from "vitest";
import { DEMO_ORG, getMockDb, resetMockDb } from "@agent-hub/db";
import type { AssistantGoal } from "@agent-hub/core";
import type { ChatReplyPart } from "./types";
import {
  failureCountOf,
  failureCountTag,
  fileGoalImprovement,
  goalImprovementTag,
  goalImprovementTitle,
  GOAL_IMPROVEMENT_TAG,
} from "./goal-improvement";

/**
 * A failing standing Goal files an Improvement the same night (#903).
 *
 * The signal used to raise a `system` Alert and stop there, while the loop
 * that could act on it ran on a 6.5-day cadence and capped at three proposals.
 * A golden question is a stronger signal than a thumbs-down cluster, because a
 * human wrote down what the right answer looks like.
 */

const goal = (over: Partial<AssistantGoal> = {}): AssistantGoal =>
  ({
    id: "goal-1",
    organizationId: DEMO_ORG.id,
    assistantId: "assistant-1",
    question: "What are the opening hours on a public holiday?",
    status: "active",
    expectations: { mustContain: ["closed"] },
    lastRunAt: null,
    lastResult: null,
    lastDetail: null,
    createdAt: "2026-09-01T00:00:00Z",
    ...over,
  }) as AssistantGoal;

const answered = (text: string): ChatReplyPart[] => [
  { type: "text", action: "search_knowledge", text },
];

beforeEach(() => {
  resetMockDb();
});

describe("the first failing night", () => {
  it("files one Improvement carrying the question, the miss and the answer", async () => {
    const db = getMockDb();
    const filed = await fileGoalImprovement(db, goal(), {
      detail: 'The answer does not contain "closed".',
      parts: answered("We are open from 9 to 5 every day."),
      now: new Date("2026-09-20T02:00:00Z"),
    });
    expect(filed?.created).toBe(true);
    expect(filed?.failures).toBe(1);

    const stored = await db.getImprovement(filed!.improvement.id);
    expect(stored?.title).toBe(
      "Standing goal failing: What are the opening hours on a public holiday?"
    );
    // All three pieces of evidence the ticket asks for, in one place a
    // reviewer reads: there is no transcript to link, because a goal eval
    // persists no Conversation.
    expect(stored?.description).toContain(
      "What are the opening hours on a public holiday?"
    );
    expect(stored?.description).toContain('The answer does not contain "closed".');
    expect(stored?.description).toContain("We are open from 9 to 5 every day.");
    expect(stored?.tags).toEqual([
      GOAL_IMPROVEMENT_TAG,
      goalImprovementTag("goal-1"),
      failureCountTag(1),
    ]);
    expect(stored?.priority).toBe("high");
  });

  it("says so plainly when the Assistant produced no answer at all", async () => {
    const db = getMockDb();
    const filed = await fileGoalImprovement(db, goal(), {
      detail: "The answer was empty.",
      parts: [],
    });
    const stored = await db.getImprovement(filed!.improvement.id);
    expect(stored?.description).toContain("the Assistant produced no answer text");
  });
});

describe("a goal that keeps failing", () => {
  it("counts up on a tag rather than filing a card", async () => {
    // The whole point of the dedup: a nightly cron means a goal that stays
    // broken fails every night.
    const db = getMockDb();
    const before = (await db.listImprovements(DEMO_ORG.id)).length;
    let last;
    for (let night = 1; night <= 4; night += 1) {
      last = await fileGoalImprovement(db, goal(), {
        detail: 'The answer does not contain "closed".',
        parts: answered("Still the wrong answer."),
      });
    }
    expect(last?.created).toBe(false);
    expect(last?.failures).toBe(4);
    expect((await db.listImprovements(DEMO_ORG.id)).length).toBe(before + 1);

    const stored = await db.getImprovement(last!.improvement.id);
    expect(failureCountOf(stored!)).toBe(4);
    expect(stored!.tags).toContain(failureCountTag(4));
    // Exactly one count tag, never an accumulating pile.
    expect(stored!.tags.filter((t) => t.startsWith("failures:"))).toHaveLength(1);
  });

  it("never rewrites a title or description the reviewer may have edited", async () => {
    // A nightly tick that rewrote both would clobber every rename and every
    // note a reviewer added, once a night, silently. The card belongs to the
    // reviewer from the moment it is filed; only the count is the cron's.
    const db = getMockDb();
    const first = await fileGoalImprovement(db, goal(), {
      detail: "missed",
      parts: answered("wrong"),
    });
    await db.updateImprovement(first!.improvement.id, {
      title: "Holiday hours are wrong — Ana is on it",
      description: "Talked to the content team, they are rewriting the page.",
    });
    await fileGoalImprovement(db, goal(), {
      detail: "missed again",
      parts: answered("still wrong"),
    });
    const stored = await db.getImprovement(first!.improvement.id);
    expect(stored?.title).toBe("Holiday hours are wrong — Ana is on it");
    expect(stored?.description).toBe(
      "Talked to the content team, they are rewriting the page."
    );
    // And the dedup still found it, so no second card appeared.
    expect(failureCountOf(stored!)).toBe(2);
  });

  it("files a fresh card once the old one is closed", async () => {
    // A closed item is a solved problem. A recurrence deserves its own card
    // rather than silently reopening history, which is the rule
    // `findOpenImprovementForConversation` already states for the other
    // producer.
    const db = getMockDb();
    const first = await fileGoalImprovement(db, goal(), {
      detail: "missed",
      parts: answered("wrong"),
    });
    await db.updateImprovement(first!.improvement.id, { status: "done" });
    const second = await fileGoalImprovement(db, goal(), {
      detail: "missed again",
      parts: answered("wrong again"),
    });
    expect(second?.created).toBe(true);
    expect(second?.failures).toBe(1);
    expect(second?.improvement.id).not.toBe(first?.improvement.id);
  });

  it("keeps two different goals apart", async () => {
    const db = getMockDb();
    const a = await fileGoalImprovement(db, goal({ id: "goal-a" }), {
      detail: "missed",
      parts: answered("wrong"),
    });
    const b = await fileGoalImprovement(db, goal({ id: "goal-b", question: "Do you ship abroad?" }), {
      detail: "missed",
      parts: answered("wrong"),
    });
    expect(b?.created).toBe(true);
    expect(b?.improvement.id).not.toBe(a?.improvement.id);
  });
});

describe("the title", () => {
  it("leads with what happened, and leaves the clamp to raiseImprovement", () => {
    // `IMPROVEMENT_TITLE_MAX` lives in `@agent-hub/db` next to the comment
    // explaining that call sites once disagreed at 80/100/120. This one owns
    // the words and nothing else.
    expect(goalImprovementTitle("Q?")).toBe("Standing goal failing: Q?");
  });
});
