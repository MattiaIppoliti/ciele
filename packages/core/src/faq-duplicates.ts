import { stem, tokenize } from "./text";

/** Conservative warning threshold; never a save gate. */
export const FAQ_DUPLICATE_THRESHOLD = 0.8;
export function faqDuplicateScore(question: string, candidate: string, semanticSimilarity = 0): number {
  const left = new Set(tokenize(question).map(stem));
  const right = new Set(tokenize(candidate).map(stem));
  const overlap = [...left].filter(word => right.has(word)).length;
  const lexical = left.size + right.size ? 2 * overlap / (left.size + right.size) : 0;
  return Math.max(lexical, semanticSimilarity);
}
