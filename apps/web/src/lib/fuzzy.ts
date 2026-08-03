/**
 * Minimum number of needle characters that must be treated as typos
 * (substituted or dropped) for the rest of needle to appear, in order, in
 * hay — i.e. an edit-distance-bounded subsequence match. Gaps in hay are
 * always free (that's what makes it a subsequence match rather than a
 * literal edit distance), so this generalizes plain subsequence matching
 * (which is just this function equal to 0).
 */
export function typoSubsequenceCost(needle: string, hay: string): number {
  const n = needle.length;
  const m = hay.length;
  if (n === 0) return 0;
  let prevRow = new Array(m + 1).fill(0); // dp[0][j] = 0: empty needle always matches
  for (let i = 1; i <= n; i++) {
    const row = new Array(m + 1);
    row[0] = i; // matching a non-empty needle prefix against empty hay costs one per char
    for (let j = 1; j <= m; j++) {
      const substCost = needle[i - 1] === hay[j - 1] ? 0 : 1;
      row[j] = Math.min(
        row[j - 1], // skip a hay char for free (subsequence gap)
        prevRow[j - 1] + substCost, // consume both chars (match or typo substitution)
        prevRow[j] + 1, // drop this needle char as a typo (extra/duplicated key)
      );
    }
    prevRow = row;
  }
  return prevRow[m];
}

/**
 * Fuzzy match with typo tolerance: allows a couple of mistyped characters.
 * Shared by the Find palette and the Improvements context menu, so both spell
 * "close enough" the same way.
 */
export function fuzzyMatch(needle: string, hay: string): boolean {
  if (!needle) return true;
  needle = needle.toLowerCase();
  hay = hay.toLowerCase();
  const maxErrors = needle.length <= 3 ? 0 : needle.length <= 6 ? 1 : 2;
  return typoSubsequenceCost(needle, hay) <= maxErrors;
}

/** {@link fuzzyScore} for a needle that is not a subsequence of the hay. */
export const NO_MATCH = -1;

const WORD_BOUNDARY = /[\s\-_./:]/;

/**
 * How good a *typo-free* match is, or {@link NO_MATCH}. This is the ranking
 * half of the pair: {@link fuzzyMatch} decides whether a candidate survives,
 * this decides where it lands. The score rewards characters that fall on a
 * word start or run consecutively and penalises what a match skips over — so
 * "csa" puts "Ciele Support Assistant" above a label that merely happens to
 * contain those letters scattered around.
 *
 * An empty needle scores 0, which keeps "no filter" and "filter" on one path.
 */
export function fuzzyScore(needle: string, hay: string): number {
  const query = needle.trim().toLowerCase();
  if (!query) return 0;
  const haystack = hay.toLowerCase();

  let score = 0;
  let cursor = 0;
  let previousIndex = -1;

  for (const char of query) {
    if (char === " ") continue;
    const index = haystack.indexOf(char, cursor);
    if (index === -1) return NO_MATCH;

    score += 1;
    if (previousIndex === -1) {
      // Prefer the earliest place the query lands at all.
      score += Math.max(0, 4 - index * 0.1);
    } else if (index === previousIndex + 1) {
      // A run of adjacent characters is the strongest signal — "sup" in
      // "Support desk" must beat the three word starts of "Sales unit planner".
      score += 10;
    } else {
      // Everything skipped over is evidence against this match.
      score -= (index - previousIndex - 1) * 1.5;
    }
    // Word starts are what people actually type ("csa", "sup ass").
    if (index === 0 || WORD_BOUNDARY.test(haystack[index - 1] ?? "")) {
      score += 8;
    }

    previousIndex = index;
    cursor = index + 1;
  }

  // A weak match is still a match: keep the score clear of the NO_MATCH sentinel.
  return Math.max(0, score);
}

/**
 * Filter `items` with {@link fuzzyMatch} — typos and all — then order what
 * survives by {@link fuzzyScore}. A typo-only match scores nothing, so it
 * sinks below the clean matches instead of disappearing. Ties and an empty
 * needle keep the caller's original order (the sort is stable).
 */
export function fuzzyFilter<T>(
  items: readonly T[],
  needle: string,
  toText: (item: T) => string
): T[] {
  const query = needle.trim();
  if (!query) return [...items];
  return items
    .map((item, index) => ({ item, index, text: toText(item) }))
    .filter((entry) => fuzzyMatch(query, entry.text))
    .map((entry) => ({ ...entry, score: Math.max(0, fuzzyScore(query, entry.text)) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item);
}
