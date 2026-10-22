/**
 * Minimum number of needle characters that must be treated as typos
 * (substituted or dropped) for the rest of needle to appear, in order, in
 * hay, i.e. an edit-distance-bounded subsequence match. Gaps in hay are
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

/** Where a match sits in its text, as `[start, end)` runs, for highlighting. */
export type MatchRanges = Array<[number, number]>;

/** Consecutive indices as runs: `[0, 1, 2, 7]` is `[[0, 3], [7, 8]]`. */
function toRanges(indices: readonly number[]): MatchRanges {
  const ranges: MatchRanges = [];
  for (const at of indices) {
    const last = ranges[ranges.length - 1];
    if (last && last[1] === at) last[1] = at + 1;
    else ranges.push([at, at + 1]);
  }
  return ranges;
}

/**
 * The hay characters the needle's cheapest typo-tolerant alignment lands on:
 * the {@link typoSubsequenceCost} table, kept whole and walked back from the
 * end. A substituted or dropped needle character marks nothing, so a typo'd
 * query still highlights the letters it got right.
 */
function alignedRanges(needle: string, hay: string): MatchRanges {
  const n = needle.length;
  const m = hay.length;
  const cost: number[][] = [new Array<number>(m + 1).fill(0)];
  for (let i = 1; i <= n; i++) {
    const prev = cost[i - 1]!;
    const row = new Array<number>(m + 1);
    row[0] = i;
    for (let j = 1; j <= m; j++) {
      const subst = needle[i - 1] === hay[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j - 1]!, prev[j - 1]! + subst, prev[j]! + 1);
    }
    cost.push(row);
  }
  const hits: number[] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const here = cost[i]![j]!;
    if (needle[i - 1] === hay[j - 1] && cost[i - 1]![j - 1] === here) {
      hits.push(j - 1);
      i--;
      j--;
    } else if (cost[i]![j - 1] === here) j--;
    else if (cost[i - 1]![j - 1]! + 1 === here) {
      i--;
      j--;
    } else i--;
  }
  return toRanges(hits.reverse());
}

/**
 * Fuzzy match with typo tolerance: allows a couple of mistyped characters.
 * Shared by the Find palette and the Improvements context menu, so both spell
 * "close enough" the same way.
 *
 * Null when the needle does not match; otherwise where it landed (#1072),
 * empty for an empty needle. A literal substring is marked whole; anything
 * else marks the letters its alignment used, typos and all, so whatever
 * matched can be highlighted rather than only what matched without typos.
 */
export function fuzzyMatch(needle: string, hay: string): MatchRanges | null {
  const query = needle.trim().toLowerCase();
  if (!query) return [];
  const haystack = hay.toLowerCase();
  const maxErrors = query.length <= 3 ? 0 : query.length <= 6 ? 1 : 2;
  if (typoSubsequenceCost(query, haystack) > maxErrors) return null;
  const literal = haystack.indexOf(query);
  if (literal >= 0) return [[literal, literal + query.length]];
  return alignedRanges(query, haystack);
}

/**
 * Every place the needle appears verbatim, ignoring case, or null when it
 * appears nowhere. The match for body text, where a typo-tolerant subsequence
 * would match almost any paragraph.
 */
export function substringMatch(needle: string, hay: string): MatchRanges | null {
  const query = needle.trim().toLowerCase();
  if (!query) return [];
  const haystack = hay.toLowerCase();
  const ranges: MatchRanges = [];
  for (let at = haystack.indexOf(query); at >= 0; at = haystack.indexOf(query, at + query.length)) {
    ranges.push([at, at + query.length]);
  }
  return ranges.length ? ranges : null;
}

/** {@link fuzzyScore} for a needle that is not a subsequence of the hay. */
export const NO_MATCH = -1;

const WORD_BOUNDARY = /[\s\-_./:]/;

/**
 * How good a *typo-free* match is, or {@link NO_MATCH}. This is the ranking
 * half of the pair: {@link fuzzyMatch} decides whether a candidate survives,
 * this decides where it lands. The score rewards characters that fall on a
 * word start or run consecutively and penalises what a match skips over, so
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
      // A run of adjacent characters is the strongest signal, "sup" in
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
 * Filter `items` with {@link fuzzyMatch}, typos and all, then order what
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
    .filter((entry) => fuzzyMatch(query, entry.text) !== null)
    .map((entry) => ({ ...entry, score: Math.max(0, fuzzyScore(query, entry.text)) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item);
}
