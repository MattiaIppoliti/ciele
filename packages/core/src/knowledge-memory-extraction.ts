/**
 * The pure half of memory extraction (#930): what the model's answer has to
 * survive before anything is written, and how a re-crawl's answer meets the
 * memories a page already has.
 *
 * Here rather than in the job so both are testable without a model, and so the
 * rules that protect a Member's editorial decisions, an invented fact is
 * refused and a forget is never undone by a crawl, are readable in one file.
 */

/** What the model is asked to return, one entry per durable fact. */
export interface ExtractedMemory {
  /** A standalone sentence: subject named, dates resolved, one fact. */
  text: string;
  /** A verbatim span of the page the sentence rests on. */
  quote: string;
}

/**
 * How many memories one extraction may write. Twenty is a reading budget, not
 * a model limit: the tab is a list a person scans, and a page that "holds"
 * fifty durable facts is usually an index, which should hold none.
 *
 * It bounds one pass, not the page's total over time. A re-crawl that rephrases
 * a fact inserts the rephrasing and leaves the old wording live, because
 * silence is not evidence (see `reconcileKnowledgeMemories`), so a page edited
 * often can carry more than twenty live rows. Accepted: trimming them would
 * mean auto-forgetting, and the Member's forget is the only forget.
 */
export const KNOWLEDGE_MEMORY_CAP = 20;

export interface FilteredMemories {
  kept: ExtractedMemory[];
  /** The filter dropped entries beyond the cap, which the record notes. */
  capped: boolean;
  /** Entries refused for having no verbatim quote in the body. */
  refused: number;
}

/**
 * The gate every extracted entry passes before it can be written.
 *
 * The quote must appear in the body **verbatim**. That is the whole
 * anti-invention rule: a model that paraphrases the page fails it, and a model
 * that made the fact up fails it hardest, because nothing it invented is in
 * the text. Whitespace is normalised on both sides first, since a chunker and
 * a crawler disagree about line breaks far more often than about words.
 *
 * The cap applies **after** the filter, so twenty good entries are kept rather
 * than twenty entries of which some are refused.
 */
export function filterExtractedMemories(
  entries: ExtractedMemory[],
  body: string,
  cap: number = KNOWLEDGE_MEMORY_CAP
): FilteredMemories {
  const haystack = normalise(body);
  const kept: ExtractedMemory[] = [];
  let refused = 0;
  const seen = new Set<string>();

  for (const entry of entries) {
    const text = entry.text.trim();
    const quote = entry.quote.trim();
    if (text.length === 0 || quote.length === 0) {
      refused += 1;
      continue;
    }
    if (!haystack.includes(normalise(quote))) {
      refused += 1;
      continue;
    }
    // One fact per entry means one entry per fact: a model that repeats itself
    // should not cost a Member two rows saying the same thing.
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push({ text, quote });
  }

  return {
    kept: kept.slice(0, cap),
    capped: kept.length > cap,
    refused,
  };
}

/** A memory as it already exists on the page, for reconciliation. */
export interface ExistingMemory {
  id: string;
  text: string;
  sourceCount: number;
  /** Live or forgotten: reconciliation must not change this either way. */
  forgottenAt: string | null;
}

export interface MemoryReconciliation {
  /** Entries the page did not already have. */
  inserts: ExtractedMemory[];
  /** Restatements: bump the count, refresh the links, touch nothing else. */
  restated: Array<{ id: string; quote: string; sourceCount: number }>;
  /** Live memories this extraction did not restate. Left alone, by decision. */
  unrestated: string[];
}

/**
 * What a re-crawl's extraction does to the memories a page already has.
 *
 * Three rules, and the second and third are the ones that matter:
 *
 * - a **new** sentence inserts;
 * - a **restated** one bumps `source_count` and refreshes its links, and
 *   **keeps its forget state**, so a wrong fact a Member forgot last week does
 *   not come back on Monday because the page still says it;
 * - a live memory the new extraction did **not** restate is left alone. Silence
 *   is not evidence: an extractor that returned fewer facts this time may have
 *   been given a truncated page, or a worse day, and auto-forgetting on that
 *   basis would quietly delete a Member's knowledge.
 *
 * Matching is on normalised text, which is what "the same fact, said again"
 * means here. A rephrasing is a new memory, and that is the honest reading: we
 * cannot tell a rephrasing from a different fact without asking a model again.
 */
export function reconcileKnowledgeMemories(
  existing: ExistingMemory[],
  extracted: ExtractedMemory[]
): MemoryReconciliation {
  const byText = new Map(existing.map((memory) => [normalise(memory.text), memory]));
  const restatedIds = new Set<string>();
  const inserts: ExtractedMemory[] = [];
  const restated: MemoryReconciliation["restated"] = [];

  for (const entry of extracted) {
    const match = byText.get(normalise(entry.text));
    if (!match) {
      inserts.push(entry);
      continue;
    }
    if (restatedIds.has(match.id)) continue;
    restatedIds.add(match.id);
    restated.push({
      id: match.id,
      quote: entry.quote,
      sourceCount: match.sourceCount + 1,
    });
  }

  return {
    inserts,
    restated,
    unrestated: existing
      .filter((memory) => memory.forgottenAt === null && !restatedIds.has(memory.id))
      .map((memory) => memory.id),
  };
}

/** Collapses whitespace and case so a line break is not a different fact. */
function normalise(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}
