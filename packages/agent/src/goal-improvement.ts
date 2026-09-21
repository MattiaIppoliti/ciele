import { messageText } from "@agent-hub/core";
import type { AssistantGoal, Improvement } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import { findOpenImprovementByTag, raiseImprovement } from "@agent-hub/db";
import type { ChatReplyPart } from "./types";

/**
 * A failing standing Goal raises an Improvement the same night (#903).
 *
 * A Goal is the sharpest quality signal the product has: an admin wrote a
 * golden question with machine-checkable expectations, and the published
 * Assistant stopped meeting them. That used to raise a `system` Alert and stop
 * there, while the quality loop that could act on it ran on a 6.5-day cadence
 * and capped at three proposals, so a goal failing tonight waited up to a week
 * and could be crowded out by thumbs-down clusters.
 *
 * ## The card belongs to the reviewer, not to the cron
 *
 * A nightly tick that rewrote the title and description would clobber every
 * rename and every note a reviewer added, once a night, silently. So the title
 * and description are written **once**, when the card is filed, and a repeat
 * failure moves one machine-owned tag and nothing else. An admin can rename
 * the card, work it, annotate it, and the dedup still finds it tomorrow.
 *
 * That is also why the count is a tag rather than a number parsed back out of
 * the title: display text is not storage, and a title a human may edit is the
 * worst possible place to keep a counter.
 *
 * ## Why this does not reuse compost's dedup
 *
 * `raiseOrAttachImprovement` dedups by walking a Conversation's linked
 * messages. A goal eval persists **no Conversation and no messages** by design
 * (see `goal-runner.ts`'s header): synthetic traffic must never enter the
 * Inbox or the Insights population. So there is nothing to walk and nothing to
 * link, which is also why the tracker's "occurrences" column reads zero for
 * these items: that number counts linked transcript messages. The count a
 * reader needs is on a tag instead, where the board shows it.
 */

/** The tag that makes one goal's card findable again tomorrow night. */
export function goalImprovementTag(goalId: string): string {
  return `goal:${goalId}`;
}

/** Marks the item as machine-filed, and is what an admin filters the board by. */
export const GOAL_IMPROVEMENT_TAG = "standing goal";

const FAILURE_TAG_PREFIX = "failures:";
const ANSWER_MAX = 1_500;

/**
 * How many times this card has been filed against.
 *
 * Deliberately NOT called "consecutive nights": the card stays open across a
 * night the goal passes, so this counts failures since the card was filed. A
 * goal that passes for a month and fails twice has failed twice, and saying
 * "2 nights running" would have been a lie the UI told.
 */
export function failureCountTag(count: number): string {
  return `${FAILURE_TAG_PREFIX}${count}`;
}

export function failureCountOf(improvement: Improvement): number {
  for (const tag of improvement.tags) {
    if (!tag.startsWith(FAILURE_TAG_PREFIX)) continue;
    const parsed = Number(tag.slice(FAILURE_TAG_PREFIX.length));
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return 1;
}

export function goalImprovementTitle(question: string): string {
  // `raiseImprovement` owns the clamp; this owns the words.
  return `Standing goal failing: ${question}`;
}

export function goalImprovementDescription(input: {
  question: string;
  detail: string;
  answer: string;
  at: string;
}): string {
  return [
    `A standing goal stopped passing on ${input.at}. This description is the evidence from that first failure and is not rewritten, so anything you add below survives the nightly check. The \`${FAILURE_TAG_PREFIX}N\` tag counts how many times it has failed since.`,
    "",
    `**Golden question**\n${input.question}`,
    "",
    `**What it missed**\n${input.detail}`,
    "",
    `**What the Assistant answered**\n${input.answer || "(the Assistant produced no answer text)"}`,
  ].join("\n");
}

export interface GoalImprovementOutcome {
  improvement: Improvement;
  /** True the first night; false when an open card was tagged instead. */
  created: boolean;
  /** Failures recorded against this card, including tonight's. */
  failures: number;
  /** The answer as filed, already flattened and capped. */
  answer: string;
}

/**
 * File, or count against, the one Improvement for this goal.
 *
 * A nightly cron means a goal that stays broken fails every night, so the
 * dedup is the whole point: one card that counts up, never one card per night.
 * Best-effort by contract, like the Alert beside it: a tracker write must
 * never break the eval loop that found the problem.
 */
export async function fileGoalImprovement(
  db: Db,
  goal: AssistantGoal,
  input: { detail: string; parts: readonly ChatReplyPart[]; now?: Date }
): Promise<GoalImprovementOutcome | null> {
  const at = (input.now ?? new Date()).toISOString();
  const answer = messageText([...input.parts], " ").trim().slice(0, ANSWER_MAX);
  const tag = goalImprovementTag(goal.id);
  try {
    const existing = await findOpenImprovementByTag(db, goal.organizationId, tag);
    if (existing) {
      const failures = failureCountOf(existing) + 1;
      // The count and nothing else. The title and description are the
      // reviewer's from here on.
      const updated = await db.updateImprovement(existing.id, {
        tags: [
          ...existing.tags.filter((t) => !t.startsWith(FAILURE_TAG_PREFIX)),
          failureCountTag(failures),
        ].slice(0, 5),
      });
      return { improvement: updated, created: false, failures, answer };
    }
    const raised = await raiseImprovement(db, goal.organizationId, {
      title: goalImprovementTitle(goal.question),
    });
    if (!raised) return null;
    const updated = await db.updateImprovement(raised.id, {
      description: goalImprovementDescription({
        question: goal.question,
        detail: input.detail,
        answer,
        at,
      }),
      tags: [GOAL_IMPROVEMENT_TAG, tag, failureCountTag(1)],
      // A golden question is a machine-checkable promise an admin wrote down.
      // Nothing else in the tracker arrives with that much intent behind it.
      priority: "high",
    });
    return { improvement: updated, created: true, failures: 1, answer };
  } catch (error) {
    // The Alert still rose. Losing the tracker card is worse than a crash in
    // the loop that is meant to keep watching every other goal tonight.
    console.error("[goal-runner] improvement filing failed:", error);
    return null;
  }
}
