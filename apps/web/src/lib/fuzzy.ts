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
