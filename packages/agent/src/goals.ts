import type { GoalExpectations } from "@agent-hub/core";
import type { ChatReplyPart } from "./types";

/**
 * Deterministic grading for standing goals: a pure function of the reply
 * parts and the goal's expectations. No adjectives, no model judgment, if
 * this function couldn't check it, it isn't a goal expectation.
 */
export interface GoalVerdict {
  pass: boolean;
  /** Empty on pass; the first failed expectation on fail. */
  detail: string;
}

export function gradeGoalReply(
  parts: ChatReplyPart[],
  expectations: GoalExpectations
): GoalVerdict {
  const textParts = parts.filter(
    (p): p is Extract<ChatReplyPart, { type: "text" }> => p.type === "text"
  );

  // Always checked: the answer must be a real answer, not the fallback
  // apology or a safety refusal.
  if (textParts.some((p) => p.action === "fallback" || p.action === "refusal")) {
    return {
      pass: false,
      detail: "The assistant answered with a fallback or refusal instead of an answer.",
    };
  }
  const answer = textParts.map((p) => p.text).join("\n\n").trim();
  if (!answer) {
    return { pass: false, detail: "The assistant produced no answer text." };
  }

  const sources = parts
    .filter(
      (p): p is Extract<ChatReplyPart, { type: "sources" }> =>
        p.type === "sources"
    )
    .flatMap((p) => p.sources);

  if ((expectations.mustCiteSources || expectations.expectedSourceUrl) && sources.length === 0) {
    return { pass: false, detail: "The answer cited no Sources." };
  }
  if (expectations.expectedSourceUrl) {
    const needle = expectations.expectedSourceUrl.toLowerCase();
    const hit = sources.some((s) => (s.url ?? "").toLowerCase().includes(needle));
    if (!hit) {
      return {
        pass: false,
        detail: `No cited Source URL contains "${expectations.expectedSourceUrl}".`,
      };
    }
  }
  const haystack = answer.toLowerCase();
  for (const fragment of expectations.mustContain ?? []) {
    if (!haystack.includes(fragment.toLowerCase())) {
      return {
        pass: false,
        detail: `The answer does not contain "${fragment}".`,
      };
    }
  }
  return { pass: true, detail: "" };
}
