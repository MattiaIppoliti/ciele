import type { ImprovementStatus } from "./types";
import { STOPWORDS, allWords, stem } from "./text";

/**
 * Near-duplicate detection for auto-filed Improvements (#767, story 15).
 *
 * The conversation-scoped walk (`findOpenImprovementForConversation`) catches
 * the same thread reporting a problem twice. It cannot catch what the spec
 * actually worries about: two *different* visitors hitting one broken answer,
 * which arrives as two conversations and used to become two board items. A
 * nightly job that files one item per complaint is the flood the cap and the
 * dedup exist to prevent.
 *
 * **This is lexical, not embedding similarity, and it only catches restatements
 * of nearly the same words.** The spec's word is "semantically"; what is
 * defensible without a provider call on an unattended nightly job is overlap
 * between the significant words of two titles. It catches "Password reset link
 * expired" against "The password reset link expires immediately", which is the
 * realistic shape of two visitors hitting one broken answer, because these
 * titles are derived from the visitor's own question. It does not catch a
 * paraphrase with different vocabulary, and a true semantic pass would need
 * embeddings on Improvements, which nothing in the schema has.
 *
 * The threshold is deliberately high, and the reason is asymmetry. A false
 * positive attaches a real problem as evidence on an unrelated item, where
 * nobody will look for it again; a false negative files a second item somebody
 * can merge in one click. So the bar sits where only a restatement clears it.
 *
 * Numbers and negations stay significant, which is why this does not go through
 * `tokenize`. "Order 12345 never arrived" against "Order 67890 never arrived" is
 * four-fifths the same words and the fifth is the whole story; "Search returns
 * results" against "Search returns no results" is the same sentence with the
 * meaning inverted, and `no` is in the router's stopword list because it
 * carries no *routing* signal. It carries all of the signal here.
 */

/**
 * Stopwords that are not stopwords for this comparison.
 *
 * The shared list exists so the deterministic router can ignore filler. A
 * negation is filler for "which flow is this" and decisive for "is this the
 * same problem", so it comes back in.
 */
const NEGATIONS = new Set([
  // en
  "no",
  "not",
  "never",
  "cannot",
  "without",
  // it
  "non",
  "nessun",
  "nessuna",
  "senza",
  "mai",
]);

/**
 * Overlap two titles must reach to count as the same problem.
 *
 * 0.85 is high on purpose: at 0.8, titles that differ by exactly one word out
 * of five match, and "Fresh problem 3" against "Fresh problem 4" is that shape.
 */
export const IMPROVEMENT_DUPLICATE_THRESHOLD = 0.85;

/**
 * The significant, stemmed words of a title, as a set.
 *
 * Like `tokenize`, minus its single-character rule for anything containing a
 * digit: an identifier or a quantity is usually the one word that distinguishes
 * two otherwise identical titles.
 */
function fingerprint(title: string): Set<string> {
  const significant = allWords(title).filter(
    (word) =>
      (NEGATIONS.has(word) || !STOPWORDS.has(word)) &&
      (word.length > 1 || /\d/.test(word))
  );
  return new Set(significant.map(stem));
}

/**
 * Sørensen-Dice overlap of two titles, 0 to 1.
 *
 * Dice rather than Jaccard because it is kinder to the length difference these
 * titles have: "Refund policy for cancelled orders" and "Refund policy" are the
 * same problem stated at two lengths, and Jaccard punishes that harder than the
 * pair deserves.
 */
export function titleSimilarity(a: string, b: string): number {
  const left = fingerprint(a);
  const right = fingerprint(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return (2 * shared) / (left.size + right.size);
}

/**
 * Whether a title says something does **not** happen.
 *
 * Polarity is not a matter of degree, so it does not belong in the score. One
 * differing word out of six is 0.86 and clears any threshold worth having, and
 * "Search returns results" against "Search returns no results" is exactly that
 * shape: near-identical wording, opposite report. Treated as a gate instead, so
 * a mismatch is never a duplicate however much the rest overlaps.
 */
function isNegated(title: string): boolean {
  return allWords(title).some((word) => NEGATIONS.has(word));
}

/** Not done and not archived: a closed item is a solved problem. */
function isOpen(status: ImprovementStatus): boolean {
  return status !== "done" && status !== "archived";
}

/**
 * The open Improvement this title is a restatement of, or null.
 *
 * Returns the *best* match rather than the first over the line, so a title that
 * looks like two open items lands on the closer one.
 */
export function findDuplicateImprovement<
  T extends { id: string; title: string; status: ImprovementStatus },
>(
  candidateTitle: string,
  improvements: readonly T[],
  threshold: number = IMPROVEMENT_DUPLICATE_THRESHOLD
): T | null {
  const candidateNegated = isNegated(candidateTitle);
  let best: T | null = null;
  let bestScore = 0;
  for (const improvement of improvements) {
    if (!isOpen(improvement.status)) continue;
    // Opposite reports of the same feature are two problems, or one problem and
    // one working feature. Either way, not the same board item.
    if (isNegated(improvement.title) !== candidateNegated) continue;
    const score = titleSimilarity(candidateTitle, improvement.title);
    if (score >= threshold && score > bestScore) {
      best = improvement;
      bestScore = score;
    }
  }
  return best;
}
