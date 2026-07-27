import type { ChatReplyPart } from "../types";
import { scoreCoverage, type SearchPass } from "./search-pass";
import type { SearchIntent } from "./query-understanding";

/**
 * Agentic Search discipline — slice 4 (issue #156, spec #61): the terminal
 * clarify decision. Pure, model-free, unit-tested directly; the `search_knowledge`
 * handler consults it at two points and the LLM loop stays the generative core.
 *
 * Instead of guessing at an unclear question or dead-ending on "no sources
 * found", the assistant asks ONE focused question and names what it did find.
 * The decision fires:
 *  - PRE-search, when query understanding couldn't resolve the message into a
 *    searchable intent ({@link SearchIntent.unresolved}); or
 *  - POST-search, when every pass came back empty/conflicting after
 *    reformulation ({@link scoreCoverage} = `empty-conflicting`).
 *
 * Anti-loop guardrail: at most ONE clarify per turn (guaranteed structurally —
 * a pre-search clarify is terminal, so post-search never also runs), and the
 * runtime never re-clarifies a message it already clarified within the
 * conversation. When `alreadyClarified` is set the decision declines to
 * clarify (`kind: "guardrail"`) so the handler gives a best-effort caveated
 * answer instead of looping.
 */

/** The phase the handler is deciding at. */
export type ClarifyPhase = "pre-search" | "post-search";

/**
 * The clarify verdict.
 * - `clarify`  — emit the built {@link ChatReplyPart} clarify part (terminal).
 * - `guardrail` — a clarify was warranted but this conversation already
 *   clarified; fall back to a best-effort caveated answer, never a 2nd clarify.
 * - `proceed`  — no clarify warranted; continue the normal flow.
 */
export type ClarifyDecision =
  | { kind: "clarify"; part: Extract<ChatReplyPart, { type: "clarify" }> }
  | { kind: "guardrail" }
  | { kind: "proceed" };

export interface ClarifyInput {
  phase: ClarifyPhase;
  /** The understood intent (its `unresolved` flag drives the pre-search case). */
  intent: SearchIntent;
  /** Passes run so far — drives the post-search coverage verdict + `found`. */
  passes: readonly SearchPass[];
  /**
   * Whether this conversation already emitted a clarify part (from the
   * persisted message history/parts). The anti-loop guardrail.
   */
  alreadyClarified: boolean;
}

/** Up to three distinct concept titles surfaced across the passes, for `found`. */
function surfacedConcepts(passes: readonly SearchPass[]): string[] {
  const seen = new Set<string>();
  const titles: string[] = [];
  for (const pass of passes) {
    for (const r of pass.results) {
      const title = r.conceptTitle.trim();
      if (!title || seen.has(title)) continue;
      seen.add(title);
      titles.push(title);
      if (titles.length >= 3) return titles;
    }
  }
  return titles;
}

/** The focused question for a pre-search unresolvable reference. */
function preSearchQuestion(): string {
  return "I want to make sure I look up the right thing — which topic (or which part of the material) are you asking about?";
}

/** The focused question for a post-search empty/conflicting dead-end. */
function postSearchQuestion(found: string[]): string {
  return found.length > 0
    ? "I couldn't find a confident answer to that. Could you rephrase it, or tell me which course or topic it belongs to?"
    : "I couldn't find anything about that in the knowledge base. Could you rephrase it, or tell me which course or topic it belongs to?";
}

/**
 * Decides whether this turn should clarify. Pure — the handler emits the
 * returned part and treats a `clarify` verdict as terminal for its generative
 * work.
 */
export function decideClarify(input: ClarifyInput): ClarifyDecision {
  const { phase, intent, passes, alreadyClarified } = input;

  if (phase === "pre-search") {
    if (!intent.unresolved) return { kind: "proceed" };
    if (alreadyClarified) return { kind: "guardrail" };
    return {
      kind: "clarify",
      part: {
        type: "clarify",
        action: "search_knowledge",
        question: preSearchQuestion(),
      },
    };
  }

  // post-search: only when nothing usable came back across every pass.
  const results = passes.flatMap((p) => p.results);
  if (scoreCoverage(results) !== "empty-conflicting") return { kind: "proceed" };
  if (alreadyClarified) return { kind: "guardrail" };
  const found = surfacedConcepts(passes);
  const part: Extract<ChatReplyPart, { type: "clarify" }> = {
    type: "clarify",
    action: "search_knowledge",
    question: postSearchQuestion(found),
  };
  if (found.length > 0) part.found = found;
  return { kind: "clarify", part };
}
