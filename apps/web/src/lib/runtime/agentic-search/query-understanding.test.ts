import { describe, expect, it } from "vitest";
import {
  buildContextFrame,
  describeSearchIntent,
  understandQuery,
  type ContextFrame,
} from "./query-understanding";
import type { HistoryMessage } from "../types";

/**
 * Pure query-understanding helpers (slice #154) — no model, following the
 * agentic-search unit-suite template. Reference resolution
 * is exercised directly over sample histories here; the loop behavior it feeds
 * is asserted at the search_knowledge seam in actions.test.ts.
 */

const user = (text: string): HistoryMessage => ({ role: "user", text });
const assistant = (text: string): HistoryMessage => ({ role: "assistant", text });

const frameOf = (history: HistoryMessage[] = [], extra: Partial<ContextFrame> = {}) =>
  buildContextFrame({ history, ...extra });

describe("buildContextFrame", () => {
  it("defaults every absent signal (graceful degradation)", () => {
    const frame = buildContextFrame({});
    expect(frame).toEqual({ collectionId: null, history: [], memory: [] });
  });

  it("keeps only the live signals given and drops blank memory", () => {
    const frame = buildContextFrame({
      collectionId: "col-1",
      history: [user("hi")],
      memory: ["Enrolled in Marketing", "   "],
    });
    expect(frame.collectionId).toBe("col-1");
    expect(frame.history).toHaveLength(1);
    expect(frame.memory).toEqual(["Enrolled in Marketing"]);
  });
});

describe("understandQuery — self-contained messages", () => {
  it("passes a plain question straight through, unresolved", () => {
    const intent = understandQuery("How do I reset my password?", frameOf());
    expect(intent.query).toBe("How do I reset my password?");
    expect(intent.resolvedFromReference).toBe(false);
    expect(intent.referent).toBeUndefined();
    expect(intent.confusedAbout).toBeUndefined();
  });

  it("does not mistake an ordinal inside a proper noun for a reference", () => {
    const intent = understandQuery(
      "Tell me about the First World War",
      frameOf([user("What history topics do you cover?")])
    );
    expect(intent.resolvedFromReference).toBe(false);
    expect(intent.query).toBe("Tell me about the First World War");
  });
});

describe("understandQuery — deictic reference resolution", () => {
  it("resolves an ordinal against an enumerated list in the last assistant turn", () => {
    const intent = understandQuery(
      "I don't understand the third concept",
      frameOf([
        user("Explain the key concepts in machine learning"),
        assistant(
          "Key concepts:\n1. Supervised learning\n2. Unsupervised learning\n3. Reinforcement learning"
        ),
      ])
    );
    expect(intent.resolvedFromReference).toBe(true);
    expect(intent.query).toBe("Reinforcement learning");
    expect(intent.referent).toBe("Reinforcement learning");
    // Confusion cue present → soft facet surfaced.
    expect(intent.confusedAbout).toBe("Reinforcement learning");
  });

  it("falls back to the antecedent topic when there is no list to index", () => {
    const intent = understandQuery(
      "what about the second one?",
      frameOf([
        user("What are the main causes of inflation?"),
        assistant("There are several economic factors involved."),
      ])
    );
    expect(intent.resolvedFromReference).toBe(true);
    expect(intent.query.toLowerCase()).toContain("inflation");
    expect(intent.query.toLowerCase()).toContain("second");
    // No confusion cue anywhere → facet omitted.
    expect(intent.confusedAbout).toBeUndefined();
  });

  it("resolves a bare anaphor to the antecedent topic", () => {
    const intent = understandQuery(
      "tell me more about that",
      frameOf([user("Tell me about the library opening hours")])
    );
    expect(intent.resolvedFromReference).toBe(true);
    expect(intent.query.toLowerCase()).toContain("library");
  });

  it("picks the most recent stand-alone user turn as the antecedent, skipping earlier references", () => {
    const intent = understandQuery(
      "and the second one?",
      frameOf([
        user("What courses are available?"),
        assistant("Several are listed."),
        user("Tell me about the photosynthesis lecture series"),
        assistant("It runs over four weeks."),
      ])
    );
    expect(intent.resolvedFromReference).toBe(true);
    expect(intent.query.toLowerCase()).toContain("photosynthesis");
  });
});

describe("understandQuery — graceful degradation when history is absent", () => {
  it("cannot resolve a reference with no antecedent, so degrades to the raw message", () => {
    const intent = understandQuery("what about the second one?", frameOf([]));
    expect(intent.resolvedFromReference).toBe(false);
    expect(intent.query).toBe("what about the second one?");
    expect(intent.referent).toBeUndefined();
    // Nothing usable to search: the clarify signal fires (#156).
    expect(intent.unresolved).toBe(true);
  });

  it("is not unresolved when a self-contained question stands alone", () => {
    expect(understandQuery("How do I reset my password?", frameOf()).unresolved).toBe(
      false
    );
  });

  it("is not unresolved when a reference resolves against history", () => {
    const intent = understandQuery(
      "what about the second one?",
      frameOf([user("What are the main causes of inflation?")])
    );
    expect(intent.resolvedFromReference).toBe(true);
    expect(intent.unresolved).toBe(false);
  });
});

describe("understandQuery — confusion facet", () => {
  it("names what the visitor is struggling with when a cue is present", () => {
    const intent = understandQuery(
      "I'm really confused about photosynthesis",
      frameOf()
    );
    expect(intent.confusedAbout?.toLowerCase()).toContain("photosynthesis");
  });

  it("derives the cue from earlier history, not only the current message", () => {
    const intent = understandQuery("what about the second one?", {
      collectionId: null,
      history: [user("I don't get the enrollment steps at all")],
      memory: [],
    });
    expect(intent.confusedAbout).toBeDefined();
  });

  it("omits the facet entirely when nothing signals confusion", () => {
    const intent = understandQuery("What is the enrollment deadline?", frameOf());
    expect(intent.confusedAbout).toBeUndefined();
  });
});

describe("describeSearchIntent — system-prompt guidance", () => {
  it("returns null when no signal is present", () => {
    const intent = understandQuery("What is the deadline?", frameOf());
    expect(describeSearchIntent(intent, frameOf())).toBeNull();
  });

  it("tells the model to search the anchored Collection first when one is present", () => {
    const frame = frameOf([], { collectionId: "col-1" });
    const intent = understandQuery("What is the deadline?", frame);
    const block = describeSearchIntent(intent, frame);
    expect(block).toContain("Knowledge Collection");
    expect(block).toContain("search that collection first");
  });

  it("surfaces a resolved reference and the confusion facet", () => {
    const frame = frameOf([
      user("Explain the key concepts"),
      assistant("Key concepts:\n1. A\n2. B\n3. Reinforcement learning"),
    ]);
    const intent = understandQuery("I don't understand the third concept", frame);
    const block = describeSearchIntent(intent, frame);
    expect(block).toContain("refers back to the conversation");
    expect(block).toContain("Reinforcement learning");
    expect(block).toContain("struggling with");
  });
});
